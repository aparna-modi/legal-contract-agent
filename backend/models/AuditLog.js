const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "register",
        "login",
        "login_failed",
        "logout",
        "logout_all",
        "token_refresh",
        "token_reuse_detected",
        "password_changed",
        "password_reset_requested",
        "password_reset_completed",
        "profile_updated",
        "session_revoked",
        "team_invite",
        "team_role_updated",
        "playbook_updated",
        "playbook_evaluated",
        "playbook_rules_generated",
        "redline_suggested",
        "missing_clause_drafted",
        "visibility_updated",
        "upload",
        "extract",
        "ask",
        "search",
        "compare",
        "export_report",
        "draft_generated",
        "draft_revised",
        "delete",
        "feedback",
      ],
      required: true,
    },
    resourceType: {
      type: String,
      default: "contract",
    },
    resourceId: {
      type: String,
      default: "",
    },
    summary: {
      type: String,
      default: "",
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
      maxlength: 250,
    },
    requestId: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
