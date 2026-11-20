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
        "upload",
        "extract",
        "ask",
        "search",
        "compare",
        "export_report",
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
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
