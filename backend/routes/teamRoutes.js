const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Organization = require("../models/Organization");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { recordAudit } = require("../utils/audit");
const { sendTeamInviteEmail } = require("../utils/mailer");
const { isValidEmail } = require("../utils/security");

const router = express.Router();
const ROLES = ["admin", "counsel", "reviewer"];

const slugify = (name) =>
  `${String(name || "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace"}-${crypto.randomBytes(3).toString("hex")}`;

async function ensureOrg(user) {
  if (user.organizationId) {
    const existing = await Organization.findById(user.organizationId);
    if (existing) return existing;
  }
  const name = user.organization || `${user.name}'s Legal Team`;
  const org = await Organization.create({
    name,
    slug: slugify(name),
    owner: user._id,
    members: [{ user: user._id, role: "admin", joinedAt: new Date() }],
  });
  await User.findByIdAndUpdate(user._id, { $set: { organizationId: org._id, organization: org.name, role: "admin" } });
  user.organizationId = org._id;
  user.role = "admin";
  return org;
}

const roleOf = (org, uid) =>
  String(org.owner) === String(uid) ? "admin" : (org.members || []).find((m) => String(m.user?._id || m.user) === String(uid))?.role || null;

router.get("/", protect, async (req, res) => {
  try {
    const org = await ensureOrg(req.user);
    const pop = await Organization.findById(org._id).populate("members.user", "name email role lastLoginAt").lean();
    const myRole = roleOf(pop, req.user._id);
    res.json({
      organization: {
        id: pop._id,
        name: pop.name,
        slug: pop.slug,
        inviteCode: myRole === "admin" ? pop.inviteCode : undefined,
        myRole,
        memberCount: pop.members.length,
        members: pop.members.map((m) => ({
          userId: m.user?._id || m.user,
          name: m.user?.name || "Member",
          email: m.user?.email || "",
          role: m.role,
          isOwner: String(pop.owner) === String(m.user?._id || m.user),
          joinedAt: m.joinedAt,
          lastLoginAt: m.user?.lastLoginAt || null,
        })),
      },
    });
  } catch (err) {
    console.error("Get team error:", err.message);
    res.status(500).json({ message: "Failed to load team workspace." });
  }
});

router.post("/invite", protect, async (req, res) => {
  try {
    const { email, role = "reviewer" } = req.body || {};
    if (!email || !isValidEmail(email)) return res.status(400).json({ message: "A valid colleague email address is required." });
    if (!ROLES.includes(role)) return res.status(400).json({ message: "Role must be admin, counsel, or reviewer." });

    const org = await ensureOrg(req.user);
    if (roleOf(org, req.user._id) !== "admin") return res.status(403).json({ message: "Only workspace admins can invite team members." });

    const normalized = String(email).trim().toLowerCase();
    const target = await User.findOne({ email: normalized });
    let status = "invite_sent";

    if (target) {
      if (org.members.some((m) => String(m.user) === String(target._id))) {
        return res.status(409).json({ message: "This user is already a member of your workspace." });
      }
      org.members.push({ user: target._id, role, joinedAt: new Date() });
      await org.save();
      await User.findByIdAndUpdate(target._id, { $set: { organizationId: org._id, organization: org.name, role } });
      status = "added_existing_user";
    }

    await sendTeamInviteEmail(normalized, org.name, req.user.name, org.inviteCode);
    recordAudit(req, { action: "team_invite", resourceType: "organization", resourceId: org._id, summary: `Invited ${normalized} as ${role.toUpperCase()}` });
    res.status(201).json({
      message: status === "added_existing_user"
        ? `${target.name} was added to ${org.name} as ${role}.`
        : `Invitation sent to ${normalized} with invite code ${org.inviteCode}.`,
      status,
      inviteCode: org.inviteCode,
    });
  } catch (err) {
    console.error("Team invite error:", err.message);
    res.status(500).json({ message: "Failed to invite team member." });
  }
});

router.post("/join", protect, async (req, res) => {
  try {
    const code = String(req.body?.inviteCode || "").trim();
    if (!code) return res.status(400).json({ message: "Invite code is required." });

    const org = await Organization.findOne({ inviteCode: code });
    if (!org) return res.status(404).json({ message: "Invalid or expired workspace invite code." });

    if (!org.members.some((m) => String(m.user) === String(req.user._id))) {
      org.members.push({ user: req.user._id, role: "reviewer", joinedAt: new Date() });
      await org.save();
    }
    await User.findByIdAndUpdate(req.user._id, { $set: { organizationId: org._id, organization: org.name } });
    res.json({ message: `Joined workspace "${org.name}".`, organizationId: org._id, organizationName: org.name });
  } catch (err) {
    console.error("Team join error:", err.message);
    res.status(500).json({ message: "Failed to join workspace." });
  }
});

router.patch("/members/:userId/role", protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ message: "Invalid member ID." });
    if (!ROLES.includes(role)) return res.status(400).json({ message: "Role must be admin, counsel, or reviewer." });

    const org = await ensureOrg(req.user);
    if (roleOf(org, req.user._id) !== "admin") return res.status(403).json({ message: "Only workspace admins can change member roles." });
    if (String(org.owner) === String(userId) && role !== "admin") return res.status(400).json({ message: "Workspace owner must retain admin role." });

    const member = org.members.find((m) => String(m.user) === String(userId));
    if (!member) return res.status(404).json({ message: "Team member not found." });

    member.role = role;
    await org.save();
    await User.findByIdAndUpdate(userId, { $set: { role } });
    recordAudit(req, { action: "team_role_updated", resourceType: "organization", resourceId: org._id, summary: `Updated member ${userId} role to ${role.toUpperCase()}` });
    res.json({ message: "Member role updated.", role });
  } catch (err) {
    console.error("Update member role error:", err.message);
    res.status(500).json({ message: "Failed to update member role." });
  }
});

router.delete("/members/:userId", protect, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ message: "Invalid member ID." });

    const org = await ensureOrg(req.user);
    if (roleOf(org, req.user._id) !== "admin") return res.status(403).json({ message: "Only workspace admins can remove team members." });
    if (String(org.owner) === String(userId)) return res.status(400).json({ message: "Cannot remove the workspace owner." });

    org.members = org.members.filter((m) => String(m.user) !== String(userId));
    await org.save();
    await User.findByIdAndUpdate(userId, { $set: { organizationId: null, organization: "Personal Workspace" } });
    res.json({ message: "Member removed from workspace." });
  } catch (err) {
    console.error("Remove member error:", err.message);
    res.status(500).json({ message: "Failed to remove team member." });
  }
});

module.exports = router;
