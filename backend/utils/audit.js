const AuditLog = require("../models/AuditLog");
const { getClientIp } = require("./security");

async function recordAudit(
  req,
  { userId = null, action, resourceType = "contract", resourceId = "", summary = "" }
) {
  const targetUserId = userId || req?.user?._id;
  if (!targetUserId) return;
  try {
    await AuditLog.create({
      user: targetUserId,
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : "",
      summary,
      ipAddress: getClientIp(req),
      userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 250),
      requestId: req?.requestId || "",
    });
  } catch (err) {
    console.warn("Audit log write skipped:", err.message);
  }
}

module.exports = { recordAudit };
