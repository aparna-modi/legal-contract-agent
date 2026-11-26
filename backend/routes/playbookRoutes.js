const express = require("express");
const mongoose = require("mongoose");

const Playbook = require("../models/Playbook");
const DocumentModel = require("../models/Document");
const ClauseModel = require("../models/Clause");
const { protect } = require("../middleware/authMiddleware");
const { aiLimiter } = require("../middleware/rateLimiters");
const { aiClient, extractAiErrorMessage } = require("../utils/aiClient");
const { recordAudit } = require("../utils/audit");

const router = express.Router();
const VALID_RULE_TYPES = new Set(["require_clause", "forbidden_keyword", "max_high_risk", "allowed_jurisdiction", "min_notice_days"]);

const JURISDICTION_PRESETS = {
  us_commercial: {
    id: "us_commercial",
    label: "US Commercial & SaaS",
    jurisdiction: "Delaware / New York / California",
    description: "Standard US B2B SaaS & MSA playbook with liability caps, notice windows, and Delaware/NY/CA governing law.",
    rules: [
      { name: "Require Limitation of Liability Cap", ruleType: "require_clause", target: "Limitation of Liability", severity: "high", guidance: "Cap aggregate liability at 12 months of fees and exclude consequential damages." },
      { name: "Require Confidentiality Protection", ruleType: "require_clause", target: "Confidentiality", severity: "medium", guidance: "Ensure mutual confidentiality with standard 3–5 year survival." },
      { name: "Approved US Governing Law", ruleType: "allowed_jurisdiction", target: "Delaware, New York, California, Texas", severity: "medium", guidance: "Request Delaware or New York law with neutral venue." },
      { name: "Minimum 30-Day Termination Notice", ruleType: "min_notice_days", target: "30", severity: "medium", guidance: "Require at least 30 days written notice and a 30-day cure period." },
      { name: "Flag Uncapped Indemnity & Liability", ruleType: "forbidden_keyword", target: "unlimited liability, sole discretion without notice", severity: "high", guidance: "Replace unlimited liability with a super-cap or 12-month fee cap." },
    ],
  },
  india_commercial: {
    id: "india_commercial",
    label: "India Commercial (Contract Act)",
    jurisdiction: "India (Karnataka / Maharashtra / Delhi)",
    description: "Tailored for Indian commercial agreements including Section 27 restraint-of-trade checks and domestic jurisdiction.",
    rules: [
      { name: "Approved Indian Jurisdiction", ruleType: "allowed_jurisdiction", target: "India, Karnataka, Bengaluru, Maharashtra, Mumbai, Delhi", severity: "high", guidance: "Specify Indian Contract Act, 1872 and courts/arbitration in Bengaluru, Mumbai, or New Delhi." },
      { name: "Require Intellectual Property Ownership", ruleType: "require_clause", target: "Intellectual Property", severity: "high", guidance: "Clearly distinguish Background IP from paid work-for-hire deliverables." },
      { name: "Flag Post-Termination Non-Compete (Sec. 27)", ruleType: "forbidden_keyword", target: "non-compete, restraint of trade, perpetual exclusivity", severity: "high", guidance: "Post-termination non-compete restraints are generally void under Section 27 of the Indian Contract Act; replace with targeted confidentiality/non-solicitation." },
      { name: "Minimum 30-Day Termination Notice", ruleType: "min_notice_days", target: "30", severity: "medium", guidance: "Include a mutual 30-day termination notice and cure window." },
      { name: "Maximum High-Risk Clauses", ruleType: "max_high_risk", target: "2", severity: "high", guidance: "Escalate contracts with more than 2 high-risk flags to legal counsel." },
    ],
  },
  uk_eu_gdpr: {
    id: "uk_eu_gdpr",
    label: "UK & EU Commercial / GDPR",
    jurisdiction: "England & Wales / Ireland / EU",
    description: "UK/EU vendor review pack covering GDPR data protection, liability fairness, and approved European venues.",
    rules: [
      { name: "Require Data Protection / Confidentiality", ruleType: "require_clause", target: "Confidentiality", severity: "high", guidance: "Include UK/EU GDPR data processing obligations and breach notification timelines." },
      { name: "Require Limitation of Liability", ruleType: "require_clause", target: "Limitation of Liability", severity: "high", guidance: "Cap commercial liability while preserving non-excludable statutory liabilities." },
      { name: "Approved UK / EU Governing Law", ruleType: "allowed_jurisdiction", target: "England, Wales, United Kingdom, Ireland, Germany, Netherlands", severity: "medium", guidance: "Align governing law to England & Wales or Ireland." },
      { name: "Flag Silent Auto-Renewal & Uncapped Penalties", ruleType: "forbidden_keyword", target: "automatically renew without notice, unlimited liability, liquidated penalty", severity: "high", guidance: "Require explicit renewal consent or 60-day advance reminder notice." },
      { name: "Minimum 30-Day Notice Period", ruleType: "min_notice_days", target: "30", severity: "medium", guidance: "Negotiate a minimum 30-day notice period for convenience termination." },
    ],
  },
  freelance_contractor: {
    id: "freelance_contractor",
    label: "Freelancer & Contractor",
    jurisdiction: "General Commercial",
    description: "Protects independent contractors on payment deadlines, conditional IP transfer, and exit flexibility.",
    rules: [
      { name: "Require Payment Terms", ruleType: "require_clause", target: "Payment", severity: "high", guidance: "Require Net-15 or Net-30 invoices with late-payment interest and milestone sign-off." },
      { name: "Require Intellectual Property Clause", ruleType: "require_clause", target: "Intellectual Property", severity: "high", guidance: "Condition IP assignment strictly upon receipt of full payment and carve out pre-existing tools." },
      { name: "Flag Unpaid Work / Broad Non-Compete", ruleType: "forbidden_keyword", target: "non-compete, forfeit all fees, without compensation", severity: "high", guidance: "Remove broad non-competes and require payment for all work completed through termination." },
      { name: "Minimum 14-Day Termination Notice", ruleType: "min_notice_days", target: "14", severity: "medium", guidance: "Ensure at least 14 days written notice and pro-rated kill fee on early cancellation." },
    ],
  },
};

async function getOrCreatePlaybook(user) {
  const query = user.organizationId ? { $or: [{ organization: user.organizationId }, { user: user._id }] } : { user: user._id };
  let playbook = await Playbook.findOne(query).sort({ updatedAt: -1 });
  if (!playbook) {
    playbook = await Playbook.create({
      user: user._id,
      organization: user.organizationId || null,
      name: "Commercial SaaS Standard Playbook",
      description: "Baseline firm risk rules covering liability caps, termination notice periods, restricted wording, and risk thresholds.",
      rules: Playbook.DEFAULT_PLAYBOOK_RULES,
    });
  }
  return playbook;
}

router.get("/presets", protect, (_, res) => {
  const presets = Object.values(JURISDICTION_PRESETS).map(({ id, label, jurisdiction, description, rules }) => ({
    id, label, jurisdiction, description, ruleCount: rules.length,
  }));
  res.json({ presets });
});

router.post("/presets/:presetId", protect, async (req, res) => {
  try {
    const preset = JURISDICTION_PRESETS[req.params.presetId];
    if (!preset) return res.status(404).json({ message: "Jurisdiction rule pack not found." });

    const playbook = await getOrCreatePlaybook(req.user);
    playbook.name = `${preset.label} Playbook`;
    playbook.description = preset.description;
    playbook.rules = preset.rules.map((r) => ({ ...r, enabled: true }));
    await playbook.save();

    recordAudit(req, {
      action: "playbook_updated",
      resourceType: "playbook",
      resourceId: playbook._id,
      summary: `Applied jurisdiction rule pack "${preset.label}" (${playbook.rules.length} rules)`,
    });
    res.json({ message: `Loaded "${preset.label}" rule pack.`, playbook });
  } catch (err) {
    console.error("Apply preset error:", err.message);
    res.status(500).json({ message: "Failed to load jurisdiction rule pack." });
  }
});

router.get("/", protect, async (req, res) => {
  try {
    aiClient.ensureWarmBackground();
    res.json({ playbook: await getOrCreatePlaybook(req.user) });
  } catch (err) {
    console.error("Get playbook error:", err.message);
    res.status(500).json({ message: "Failed to load legal playbook." });
  }
});

router.put("/", protect, async (req, res) => {
  try {
    const { name, description, rules } = req.body || {};
    const playbook = await getOrCreatePlaybook(req.user);
    if (typeof name === "string" && name.trim()) playbook.name = name.trim().slice(0, 120);
    if (typeof description === "string") playbook.description = description.trim().slice(0, 400);
    if (Array.isArray(rules)) {
      playbook.rules = rules
        .filter((r) => r && r.name && VALID_RULE_TYPES.has(r.ruleType) && r.target !== undefined)
        .slice(0, 30)
        .map((r) => ({
          name: String(r.name).trim().slice(0, 120),
          ruleType: r.ruleType,
          target: String(r.target).trim().slice(0, 240),
          severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "high",
          guidance: String(r.guidance || "").trim().slice(0, 400),
          enabled: r.enabled !== false,
        }));
    }
    await playbook.save();
    recordAudit(req, { action: "playbook_updated", resourceType: "playbook", resourceId: playbook._id, summary: `Updated playbook "${playbook.name}" (${playbook.rules.length} rules)` });
    res.json({ message: "Legal playbook saved.", playbook });
  } catch (err) {
    console.error("Update playbook error:", err.message);
    res.status(500).json({ message: "Failed to save legal playbook." });
  }
});

router.post("/generate-rules", protect, aiLimiter, async (req, res) => {
  try {
    const { policyText = "", jurisdiction = "" } = req.body || {};
    const cleaned = String(policyText || "").trim();
    if (cleaned.length < 10) {
      return res.status(400).json({ message: "Describe your legal policy in at least 10 characters." });
    }
    const aiRes = await aiClient.request("/api/v1/playbook/generate-rules", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        policy_text: cleaned.slice(0, 3000),
        jurisdiction: String(jurisdiction || "").slice(0, 160),
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "Failed to generate playbook rules.");
      return res.status(aiRes.status).json({ message });
    }
    const generated = await aiRes.json();
    recordAudit(req, {
      action: "playbook_rules_generated",
      resourceType: "playbook",
      summary: `Generated ${(generated.rules || []).length} playbook rule(s) from natural-language policy`,
    });
    res.json(generated);
  } catch (err) {
    console.error("Generate playbook rules error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate playbook rules." });
  }
});

router.post("/evaluate/:contractId", protect, aiLimiter, async (req, res) => {
  try {
    const { contractId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contractId)) return res.status(400).json({ message: "Invalid contract ID." });

    const contract = await DocumentModel.findById(contractId);
    if (!contract) return res.status(404).json({ message: "Contract not found." });

    const isOwner = String(contract.user) === String(req.user._id);
    const isTeam = contract.visibility === "team" && contract.organization && req.user.organizationId &&
      String(contract.organization) === String(req.user.organizationId);
    if (!isOwner && !isTeam) return res.status(403).json({ message: "Unauthorized access to this contract." });

    const { presetId = "", useAiAudit = true } = req.body || {};
    const [playbook, clauses] = await Promise.all([
      getOrCreatePlaybook(req.user),
      ClauseModel.find({ document: contract._id }).lean(),
    ]);
    if (!clauses.length) return res.status(400).json({ message: "Analyze this contract before evaluating against your playbook." });

    const activePreset = presetId && JURISDICTION_PRESETS[presetId] ? JURISDICTION_PRESETS[presetId] : null;
    const evalName = activePreset ? `${activePreset.label} Pack` : playbook.name;
    const evalRules = activePreset
      ? activePreset.rules.map((r, idx) => ({ id: `${presetId}_${idx}`, name: r.name, ruleType: r.ruleType, target: r.target, severity: r.severity, guidance: r.guidance || "", enabled: true }))
      : playbook.rules.map((r) => ({ id: String(r._id), name: r.name, ruleType: r.ruleType, target: r.target, severity: r.severity, guidance: r.guidance || "", enabled: r.enabled }));

    const aiRes = await aiClient.request("/api/v1/playbook/evaluate", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        clauses: clauses.map((c) => ({ clause_type: c.clauseType, text: c.text, risk_level: c.riskLevel })),
        missing_clauses: contract.missingClauses || [],
        key_facts: contract.keyFacts || {},
        rules: evalRules,
        use_ai_audit: Boolean(useAiAudit),
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "Playbook evaluation failed.");
      return res.status(aiRes.status).json({ message });
    }

    const evaluation = await aiRes.json();
    recordAudit(req, { action: "playbook_evaluated", resourceType: "contract", resourceId: contract._id, summary: `Evaluated "${contract.title}" against "${evalName}" (${evaluation.compliance_score}% compliant)` });
    res.json({ playbookName: evalName, contractId: contract._id, contractTitle: contract.title, ...evaluation });
  } catch (err) {
    console.error("Evaluate playbook error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to evaluate contract against playbook." });
  }
});

module.exports = router;
