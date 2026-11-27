const mongoose = require("mongoose");

const playbookRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    ruleType: {
      type: String,
      enum: [
        "require_clause",
        "forbidden_keyword",
        "max_high_risk",
        "allowed_jurisdiction",
        "min_notice_days",
        "require_defined_term",
        "forbid_unilateral_amendment",
        "require_cure_period_days",
        "max_liability_cap_months",
      ],
      required: true,
    },
    target: { type: String, required: true, trim: true, maxlength: 240 },
    severity: { type: String, enum: ["high", "medium", "low"], default: "high" },
    guidance: { type: String, default: "", maxlength: 400 },
    enabled: { type: Boolean, default: true },
  },
  { _id: true }
);

const playbookSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: "Commercial SaaS Standard Playbook",
    },
    description: {
      type: String,
      default: "Baseline risk rules and negotiation standards for vendor and commercial contracts.",
      maxlength: 400,
    },
    rules: {
      type: [playbookRuleSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const DEFAULT_PLAYBOOK_RULES = [
  {
    name: "Limitation of Liability Cap Required",
    ruleType: "require_clause",
    target: "Limitation of Liability",
    severity: "high",
    guidance: "Cap aggregate liability at 12 months of fees paid and exclude consequential damages.",
    enabled: true,
  },
  {
    name: "Termination Provision Required",
    ruleType: "require_clause",
    target: "Termination",
    severity: "high",
    guidance: "Ensure mutual termination for material breach with a 30-day cure period.",
    enabled: true,
  },
  {
    name: "Minimum 30-Day Notice Window",
    ruleType: "min_notice_days",
    target: "30",
    severity: "medium",
    guidance: "Require at least 30 days prior written notice before cancellation or non-renewal.",
    enabled: true,
  },
  {
    name: "Flag Unlimited Liability or Sole Discretion",
    ruleType: "forbidden_keyword",
    target: "unlimited liability, sole discretion without notice, perpetual non-compete",
    severity: "high",
    guidance: "Push back on uncapped liability and unilateral modification rights.",
    enabled: true,
  },
  {
    name: "Maximum 2 High-Risk Clauses",
    ruleType: "max_high_risk",
    target: "2",
    severity: "high",
    guidance: "Escalate any contract with more than 2 unresolved high-risk clauses to senior counsel.",
    enabled: true,
  },
];

playbookSchema.statics.DEFAULT_PLAYBOOK_RULES = DEFAULT_PLAYBOOK_RULES;

module.exports = mongoose.model("Playbook", playbookSchema);
