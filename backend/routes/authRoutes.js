const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const PasswordResetToken = require("../models/PasswordResetToken");
const { protect } = require("../middleware/authMiddleware");
const { aiClient } = require("../utils/aiClient");
const { recordAudit } = require("../utils/audit");
const { sendPasswordResetEmail } = require("../utils/mailer");
const { isValidEmail, validatePasswordStrength, getClientIp, parseDeviceLabel } = require("../utils/security");
const {
  REFRESH_COOKIE_NAME, signAccessToken, generateRefreshToken, hashToken,
  getRefreshExpiryDate, setRefreshCookie, clearRefreshCookie, parseCookies,
} = require("../utils/tokens");

const router = express.Router();
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCKOUT_MS = Number(process.env.LOCKOUT_DURATION_MS || 15 * 60 * 1000);
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8K9q8bH9fM8N9f7C8eP3vZ1dO2rG6e";

function verifyCookieOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return next();
  const allowed = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.includes(origin) || allowed.includes("*")) return next();
  return res.status(403).json({ code: "CSRF_ORIGIN_BLOCKED", message: "Cross-origin cookie request blocked." });
}

async function issueSession(req, res, user, family = crypto.randomUUID()) {
  const accessToken = signAccessToken(user);
  const rawRefresh = generateRefreshToken();
  const tokenHash = hashToken(rawRefresh);
  await RefreshToken.create({
    user: user._id,
    tokenHash,
    family,
    expiresAt: getRefreshExpiryDate(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    ipAddress: getClientIp(req),
    lastUsedAt: new Date(),
  });
  setRefreshCookie(res, rawRefresh);
  return { accessToken, tokenHash };
}

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, organization } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email, and password are required." });

    const trimmedName = String(name).trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) return res.status(400).json({ message: "Name must be between 2 and 100 characters." });

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) return res.status(400).json({ message: "Please provide a valid email address." });

    const pwErr = validatePasswordStrength(password);
    if (pwErr) return res.status(400).json({ message: pwErr });

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: "reviewer",
      organization: typeof organization === "string" && organization.trim() ? organization.trim().slice(0, 120) : "Personal Workspace",
      lastLoginAt: new Date(),
    });
    const { accessToken } = await issueSession(req, res, user);

    recordAudit(req, { userId: user._id, action: "register", resourceType: "auth", resourceId: user._id, summary: `Created workspace account (${user.organization})` });
    res.status(201).json({ message: "Account created successfully.", token: accessToken, accessToken, user: user.toSafeProfile() });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: "An account with this email already exists." });
    console.error("Registration error:", err.message);
    res.status(500).json({ message: "Unable to create account right now." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      await bcrypt.compare(String(password), DUMMY_HASH);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (user.isLocked()) {
      const retrySec = Math.max(1, Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retrySec));
      return res.status(423).json({
        code: "ACCOUNT_LOCKED",
        message: `Account temporarily locked due to repeated failed sign-in attempts. Try again in ${Math.ceil(retrySec / 60)} minute(s).`,
        retryAfterSeconds: retrySec,
      });
    }

    if (!(await bcrypt.compare(String(password), user.password))) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      user.failedLoginAttempts = attempts;
      if (attempts >= MAX_FAILED_LOGINS) user.lockUntil = new Date(Date.now() + LOCKOUT_MS);
      await user.save();
      recordAudit(req, {
        userId: user._id,
        action: "login_failed",
        resourceType: "auth",
        resourceId: user._id,
        summary: `Failed sign-in attempt #${attempts}${attempts >= MAX_FAILED_LOGINS ? "; account locked" : ""}`,
      });
      return res.status(401).json({ message: "Invalid email or password." });
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const { accessToken } = await issueSession(req, res, user);
    aiClient.ensureWarmBackground();
    recordAudit(req, { userId: user._id, action: "login", resourceType: "auth", resourceId: user._id, summary: `Signed in from ${parseDeviceLabel(req.headers["user-agent"])}` });
    res.json({ message: "Signed in successfully.", token: accessToken, accessToken, user: user.toSafeProfile() });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Unable to sign in right now." });
  }
});

router.post("/refresh", verifyCookieOrigin, async (req, res) => {
  try {
    const raw = parseCookies(req)[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    if (!raw) return res.status(401).json({ code: "REFRESH_MISSING", message: "Refresh session token not provided." });

    const stored = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!stored) {
      clearRefreshCookie(res);
      return res.status(401).json({ code: "REFRESH_INVALID", message: "Invalid refresh session." });
    }

    if (stored.revokedAt) {
      await RefreshToken.updateMany({ family: stored.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
      clearRefreshCookie(res);
      recordAudit(req, { userId: stored.user, action: "token_reuse_detected", resourceType: "auth", resourceId: stored.family, summary: "Detected refresh token replay; revoked token family" });
      return res.status(401).json({ code: "REFRESH_REUSE_DETECTED", message: "Session security alert: please sign in again." });
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      stored.revokedAt = new Date();
      await stored.save();
      clearRefreshCookie(res);
      return res.status(401).json({ code: "REFRESH_EXPIRED", message: "Session expired. Please sign in again." });
    }

    const user = await User.findById(stored.user).select("-password");
    if (!user) {
      stored.revokedAt = new Date();
      await stored.save();
      clearRefreshCookie(res);
      return res.status(401).json({ message: "User account not found." });
    }

    const { accessToken, tokenHash: nextHash } = await issueSession(req, res, user, stored.family);
    stored.revokedAt = new Date();
    stored.replacedByHash = nextHash;
    stored.lastUsedAt = new Date();
    await stored.save();

    res.json({ message: "Session refreshed.", token: accessToken, accessToken, user: user.toSafeProfile() });
  } catch (err) {
    console.error("Token refresh error:", err.message);
    res.status(500).json({ message: "Unable to refresh session." });
  }
});

router.post("/logout", verifyCookieOrigin, async (req, res) => {
  try {
    const raw = parseCookies(req)[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    if (raw) {
      const doc = await RefreshToken.findOneAndUpdate({ tokenHash: hashToken(raw), revokedAt: null }, { $set: { revokedAt: new Date() } });
      if (doc) recordAudit(req, { userId: doc.user, action: "logout", resourceType: "auth", summary: "Signed out of current session" });
    }
  } catch (err) {
    console.error("Logout error:", err.message);
  }
  clearRefreshCookie(res);
  res.json({ message: "Signed out successfully." });
});

router.post("/logout-all", protect, async (req, res) => {
  try {
    await Promise.all([
      User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } }),
      RefreshToken.updateMany({ user: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } }),
    ]);
    clearRefreshCookie(res);
    recordAudit(req, { action: "logout_all", resourceType: "auth", resourceId: req.user._id, summary: "Revoked all active sessions across all devices" });
    res.json({ message: "All active sessions have been revoked." });
  } catch (err) {
    console.error("Logout-all error:", err.message);
    res.status(500).json({ message: "Unable to revoke all sessions." });
  }
});

router.get("/me", protect, async (req, res) => {
  try {
    aiClient.ensureWarmBackground();
    const activeSessions = await RefreshToken.countDocuments({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } });
    res.json({
      user: req.user.toSafeProfile(),
      security: { activeSessions, tokenVersion: req.user.tokenVersion || 0, passwordChangedAt: req.user.passwordChangedAt || null },
    });
  } catch (err) {
    console.error("Profile fetch error:", err.message);
    res.status(500).json({ message: "Failed to load account profile." });
  }
});

router.patch("/profile", protect, async (req, res) => {
  try {
    const { name, organization } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      const clean = String(name).trim();
      if (clean.length < 2 || clean.length > 100) return res.status(400).json({ message: "Name must be between 2 and 100 characters." });
      updates.name = clean;
    }
    if (organization !== undefined) {
      const clean = String(organization).trim();
      if (clean.length > 120) return res.status(400).json({ message: "Workspace name cannot exceed 120 characters." });
      updates.organization = clean || "Personal Workspace";
    }
    const updated = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true }).select("-password");
    recordAudit(req, { action: "profile_updated", resourceType: "auth", resourceId: req.user._id, summary: "Updated profile and workspace metadata" });
    res.json({ message: "Profile updated.", user: updated.toSafeProfile() });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ message: "Failed to update profile." });
  }
});

router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ message: "Current and new password are required." });
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) return res.status(400).json({ message: pwErr });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User account not found." });
    if (!(await bcrypt.compare(String(currentPassword), user.password))) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    user.password = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.passwordChangedAt = new Date();
    await user.save();

    await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const { accessToken } = await issueSession(req, res, user);

    recordAudit(req, { action: "password_changed", resourceType: "auth", resourceId: user._id, summary: "Changed account password and rotated active sessions" });
    res.json({ message: "Password updated. All other sessions have been signed out.", token: accessToken, accessToken, user: user.toSafeProfile() });
  } catch (err) {
    console.error("Change password error:", err.message);
    res.status(500).json({ message: "Unable to change password right now." });
  }
});

router.get("/sessions", protect, async (req, res) => {
  try {
    const cookieVal = parseCookies(req)[REFRESH_COOKIE_NAME];
    const currentHash = cookieVal ? hashToken(cookieVal) : null;
    const rows = await RefreshToken.find({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .limit(20)
      .lean();
    res.json({
      sessions: rows.map((r) => ({
        id: r._id,
        device: parseDeviceLabel(r.userAgent),
        ipAddress: r.ipAddress || "Unknown",
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt || r.createdAt,
        expiresAt: r.expiresAt,
        current: Boolean(currentHash && r.tokenHash === currentHash),
      })),
    });
  } catch (err) {
    console.error("List sessions error:", err.message);
    res.status(500).json({ message: "Failed to load active sessions." });
  }
});

router.delete("/sessions/:sessionId", protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return res.status(400).json({ message: "Invalid session ID." });

    const session = await RefreshToken.findOneAndUpdate(
      { _id: sessionId, user: req.user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { new: true }
    );
    if (!session) return res.status(404).json({ message: "Active session not found." });

    recordAudit(req, { action: "session_revoked", resourceType: "auth", resourceId: session._id, summary: `Revoked session (${parseDeviceLabel(session.userAgent)})` });
    res.json({ message: "Session revoked." });
  } catch (err) {
    console.error("Revoke session error:", err.message);
    res.status(500).json({ message: "Failed to revoke session." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !isValidEmail(email)) return res.status(400).json({ message: "Please provide a valid email address." });

    const normalized = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalized });
    const payload = { message: "If an account exists for that email, password reset instructions have been issued." };

    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      await PasswordResetToken.create({
        user: user._id,
        tokenHash: hashToken(rawToken),
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      const mail = await sendPasswordResetEmail(normalized, rawToken);
      if (process.env.NODE_ENV !== "production" && !mail.delivered) payload.devResetToken = rawToken;
      recordAudit(req, { userId: user._id, action: "password_reset_requested", resourceType: "auth", resourceId: user._id, summary: "Requested password reset link" });
    }
    res.json(payload);
  } catch (err) {
    console.error("Forgot password error:", err.message);
    res.status(500).json({ message: "Unable to process password reset request." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token: rawToken, newPassword } = req.body || {};
    if (!rawToken || !newPassword) return res.status(400).json({ message: "Reset token and new password are required." });
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) return res.status(400).json({ message: pwErr });

    const record = await PasswordResetToken.findOne({
      tokenHash: hashToken(rawToken),
      purpose: "password_reset",
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ message: "Reset token is invalid or has expired." });

    const user = await User.findById(record.user);
    if (!user) return res.status(404).json({ message: "Associated user account not found." });

    user.password = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.passwordChangedAt = new Date();
    await user.save();

    record.usedAt = new Date();
    await record.save();
    await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    recordAudit(req, { userId: user._id, action: "password_reset_completed", resourceType: "auth", resourceId: user._id, summary: "Completed password reset and revoked prior sessions" });
    res.json({ message: "Password has been reset. You can now sign in with your new password." });
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ message: "Unable to reset password right now." });
  }
});

module.exports = router;
