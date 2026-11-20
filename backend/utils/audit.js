const AuditLog = require("../models/AuditLog");

async function recordAudit(req, { action, resourceType = "contract", resourceId = "", summary = "" }) {
  if (!req?.user?._id) return;
  try {
    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";
    await AuditLog.create({
      user: req.user._id,
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : "",
      summary,
      ipAddress: ip,
    });
  } catch (err) {
    console.warn("Audit log write skipped:", err.message);
  }
}

module.exports = { recordAudit };
