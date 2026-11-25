const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const REFRESH_COOKIE_NAME = "lca_refresh_token";
const JWT_ISSUER = "legal-contract-agent";
const JWT_AUDIENCE = "legal-contract-agent-web";
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_EXPIRES || "15m";
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not configured.");
  }
  return secret;
}

function signAccessToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role || "reviewer",
      tv: user.tokenVersion || 0,
      jti: crypto.randomUUID(),
    },
    getJwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: ACCESS_TOKEN_TTL,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function getRefreshExpiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function getCookieBaseOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const sameSite = (process.env.COOKIE_SAMESITE || (isProd ? "none" : "lax")).toLowerCase();
  return {
    httpOnly: true,
    secure: isProd || sameSite === "none",
    sameSite,
    path: "/api/auth",
  };
}

function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    ...getCookieBaseOptions(),
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieBaseOptions());
}

function parseCookies(req) {
  const header = req.headers?.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  });
  return cookies;
}

module.exports = {
  REFRESH_COOKIE_NAME,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  getRefreshExpiryDate,
  setRefreshCookie,
  clearRefreshCookie,
  parseCookies,
};
