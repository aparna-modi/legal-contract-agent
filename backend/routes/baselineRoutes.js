const express = require("express");
const mongoose = require("mongoose");

const BaselineModel = require("../models/Baseline");
const DocumentModel = require("../models/Document");
const { protect } = require("../middleware/authMiddleware");
const { aiLimiter } = require("../middleware/rateLimiters");
const { aiClient, extractAiErrorMessage } = require("../utils/aiClient");
const { recordAudit } = require("../utils/audit");

const router = express.Router();

const CURATED_BASELINES = [
  {
    _id: "curated_india_msa",
    isCurated: true,
    name: "India Commercial MSA — Gold Standard Baseline",
    contractType: "msa",
    jurisdiction: "India (Indian Contract Act, 1872)",
    stance: "balanced",
    version: "v3.0",
    presentationScore: 100,
    sections: [
      "1. DEFINITIONS AND INTERPRETATION",
      "2. SCOPE, DELIVERABLES AND ACCEPTANCE",
      "3. TERM AND RENEWAL",
      "4. FEES, INVOICING AND STATUTORY TAXES",
      "5. CONFIDENTIALITY AND DATA PROTECTION",
      "6. INTELLECTUAL PROPERTY RIGHTS",
      "7. TERMINATION AND CURE PERIOD",
      "8. LIMITATION OF LIABILITY AND INDEMNIFICATION",
      "9. FORCE MAJEURE",
      "10. GOVERNING LAW AND JURISDICTION",
      "11. DISPUTE RESOLUTION AND ARBITRATION",
      "12. GENERAL PROVISIONS",
      "SCHEDULE A — SCOPE OF DELIVERABLES",
      "SCHEDULE B — COMMERCIAL CONSIDERATION",
    ],
    notes: "Complete 12-article law-firm baseline with Recitals, Definitions, GST/TDS clarity, DPDP security, Arbitration seat, Schedules, and 2-witness execution.",
    fullText: `MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into effective as of [Effective Date] ("Effective Date") by and between [Client Legal Name] ("First Party") and [Service Provider Legal Name] ("Second Party").

RECITALS
WHEREAS, First Party desires to engage Second Party for specialized professional and technology services; and
WHEREAS, Second Party represents that it possesses the qualifications and authority to deliver such services;

NOW, THEREFORE, in consideration of the mutual covenants herein contained, the Parties agree as follows:

1. DEFINITIONS AND INTERPRETATION
1.1 "Business Day" means any day other than a Saturday, Sunday, or gazetted holiday in Bengaluru. "Confidential Information" means all non-public business, technical, financial, and personal data disclosed hereunder. "Deliverables" means all custom outputs listed in Schedule A. "Background IP" means pre-existing intellectual property owned independently by a Party.
1.2 Headings are for reference only; references to statutes include amendments; main body prevails over Schedules unless expressly overridden.

2. SCOPE, DELIVERABLES AND ACCEPTANCE
2.1 Second Party shall perform the services and deliver all Deliverables specified in Schedule A with professional skill and care.
2.2 Deliverables undergo a ten (10) Business Day written acceptance review with ten (10) Business Days cure for documented non-conformities.

3. TERM AND RENEWAL
3.1 This Agreement remains effective for twelve (12) months from the Effective Date unless terminated earlier under Section 7.
3.2 Renewal requires express bilateral written confirmation; no automatic renewal applies.

4. FEES, INVOICING AND STATUTORY TAXES
4.1 Undisputed invoices are payable within thirty (30) calendar days. Fees are exclusive of applicable GST; statutory TDS shall be deducted per Income-tax Act, 1961 with Form 16A certificates provided.

5. CONFIDENTIALITY AND DATA PROTECTION
5.1 Each Party shall safeguard Confidential Information for three (3) years post-termination (indefinitely for trade secrets), comply with the DPDP Act, 2023 and IT Act, 2000, report breaches within seventy-two (72) hours, and return or destroy data on exit.

6. INTELLECTUAL PROPERTY RIGHTS
6.1 Each Party retains its Background IP. Upon receipt of full payment for accepted Deliverables, ownership of custom Deliverables vests in First Party with a perpetual license to any embedded Background IP.

7. TERMINATION AND CURE PERIOD
7.1 Either Party may terminate for convenience upon thirty (30) days prior written notice or for uncured material breach following thirty (30) days written cure notice.

8. LIMITATION OF LIABILITY AND INDEMNIFICATION
8.1 Except for confidentiality breach, third-party IP indemnity, fraud, or willful misconduct, aggregate liability is capped at twelve (12) months' total fees and consequential damages are excluded.
8.2 Each Party shall indemnify the other for third-party IP infringement and gross negligence subject to prompt notice and defense control.

9. FORCE MAJEURE
9.1 Extraordinary events beyond reasonable control excuse performance upon five (5) Business Days written notice; either Party may terminate if disruption exceeds forty-five (45) days.

10. GOVERNING LAW AND JURISDICTION
10.1 Governed by the laws of India, with exclusive jurisdiction of competent courts at Bengaluru, Karnataka.

11. DISPUTE RESOLUTION AND ARBITRATION
11.1 Senior executives shall negotiate in good faith for thirty (30) days, failing which disputes shall be resolved by binding arbitration by a mutually appointed sole arbitrator seated in Bengaluru under the Arbitration and Conciliation Act, 1996.

12. GENERAL PROVISIONS
12.1 Survival: Sections 1, 4, 5, 6, 8, 10, 11, and 12 survive termination.
12.2 Severability, Entire Agreement, No Assignment without consent, Notices with deemed delivery, and Electronic Execution under IT Act Sec. 10A apply.

SCHEDULE A — SCOPE OF DELIVERABLES
| Item | Deliverable | Acceptance Standard | Timeline |
| --- | --- | --- | --- |
| 1 | Primary Services | Written UAT Sign-Off | Per SOW |

SCHEDULE B — COMMERCIAL CONSIDERATION
| Milestone | Trigger | Payment Terms | Tax |
| --- | --- | --- | --- |
| Monthly / Milestone | Approved Tax Invoice | Net 30 Days | Plus GST; TDS applicable |

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.

For [Client Legal Name]: ___________________________   Date: _______________
For [Service Provider Legal Name]: ___________________________   Date: _______________

WITNESSES:
1. ___________________________
2. ___________________________`,
  },
  {
    _id: "curated_india_sale",
    isCurated: true,
    name: "India Property Sale Agreement — Conveyance Baseline",
    contractType: "sale_agreement",
    jurisdiction: "India (Transfer of Property Act, 1882 & RERA, 2016)",
    stance: "user_favorable",
    version: "v3.0",
    presentationScore: 100,
    sections: [
      "1. DEFINITIONS AND PROPERTY SCHEDULE",
      "2. SALE CONSIDERATION, ADVANCE & TDS (SEC. 194-IA)",
      "3. MARKETABLE TITLE, ENCUMBRANCES & DUE DILIGENCE",
      "4. POSSESSION, REGISTRATION & STAMP DUTY",
      "5. DEFAULT, SPECIFIC PERFORMANCE & REFUND REMEDIES",
      "6. FORCE MAJEURE, GOVERNING LAW & ARBITRATION",
      "SCHEDULE A — PROPERTY DESCRIPTION",
      "SCHEDULE B — PAYMENT MILESTONES",
    ],
    notes: "Buyer-protective Indian immovable property conveyance baseline aligned with ToPA Sec. 54/55, Registration Act Sec. 17, RERA 2016, and Income-tax Act Sec. 194-IA.",
    fullText: `AGREEMENT TO SELL IMMOVABLE PROPERTY

This Agreement to Sell ("Agreement") is executed effective [Effective Date] by and between [Vendor Legal Name] ("Vendor") and [Purchaser Legal Name] ("Purchaser").

RECITALS
WHEREAS, Vendor represents sole, absolute, and marketable title over the Schedule A Property free from all encumbrances; and
WHEREAS, Purchaser agrees to acquire the Schedule A Property subject to satisfactory legal title scrutiny;

NOW, THEREFORE, the Parties agree as follows:

1. DEFINITIONS AND PROPERTY SCHEDULE
1.1 "Schedule Property" means the immovable property described in Schedule A together with undivided share of land, parking, and easements. "Closing Date" means the registration date specified in Schedule B.

2. SALE CONSIDERATION, ADVANCE & TDS (SEC. 194-IA)
2.1 Total Sale Consideration shall be paid in accordance with Schedule B. Purchaser shall deduct 1% Tax Deducted at Source (TDS) under Section 194-IA of the Income-tax Act, 1961 where consideration equals or exceeds INR 50,00,000 and furnish Form 16B.

3. MARKETABLE TITLE, ENCUMBRANCES & DUE DILIGENCE
3.1 Vendor warrants clear, marketable title under Section 55 of the Transfer of Property Act, 1882 and shall deliver original parent deeds, Khata, tax receipts, OC/CC, and Encumbrance Certificates within seven (7) days. If any title defect emerges, Vendor shall refund 100% of advance monies with 12% p.a. interest within fifteen (15) days.

4. POSSESSION, REGISTRATION & STAMP DUTY
4.1 Vendor shall deliver vacant, peaceful physical possession simultaneously with execution and registration of the Sale Deed under Section 17 of the Registration Act, 1908, clearing all prior property taxes, electricity, water, and association dues up to registration.

5. DEFAULT, SPECIFIC PERFORMANCE & REFUND REMEDIES
5.1 Upon Vendor default, Purchaser may enforce specific performance under Section 10 of the Specific Relief Act, 1963 or claim full refund with interest. Any liquidated compensation shall comply with Section 74 of the Indian Contract Act, 1872.

6. GENERAL PROVISIONS, GOVERNING LAW & DISPUTE RESOLUTION
6.1 Survival, Severability, Entire Agreement, and formal RPAD/email Notices apply. Governed by Indian law with exclusive jurisdiction of courts where the Schedule Property is situated and optional binding arbitration under the Arbitration and Conciliation Act, 1996.

SCHEDULE A — PROPERTY DESCRIPTION
| Parameter | Details |
| --- | --- |
| Property Address / Flat No. | [Property Address & Unit No.] |
| Built-Up Area / UDS | [Area in Sq. Ft. & UDS] |

SCHEDULE B — PAYMENT MILESTONES
| Stage | Amount | Mode |
| --- | --- | --- |
| Advance / Earnest | [Advance Amount] | RTGS / NEFT |
| Closing Registration | [Balance Consideration] | Demand Draft / RTGS less 1% TDS |

IN WITNESS WHEREOF, the Parties have signed this Agreement before the undersigned witnesses.

Vendor: ___________________________   Purchaser: ___________________________
WITNESSES:
1. ___________________________
2. ___________________________`,
  },
];

function userBaselineFilter(user) {
  return user.organizationId
    ? { $or: [{ user: user._id }, { organization: user.organizationId, visibility: "team" }] }
    : { user: user._id };
}

router.get("/", protect, async (req, res) => {
  try {
    const custom = await BaselineModel.find(userBaselineFilter(req.user))
      .sort({ updatedAt: -1 })
      .lean();
    res.json({
      baselines: [...custom, ...CURATED_BASELINES],
      customCount: custom.length,
      curatedCount: CURATED_BASELINES.length,
    });
  } catch (err) {
    console.error("List baselines error:", err.message);
    res.status(500).json({ message: "Failed to load baselines." });
  }
});

router.post("/", protect, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 180);
    const fullText = String(b.fullText ?? b.full_text ?? "").trim();
    if (!name) return res.status(400).json({ message: "Baseline name is required." });
    if (fullText.length < 50) return res.status(400).json({ message: "Baseline text must be at least 50 characters." });

    const baseline = await BaselineModel.create({
      user: req.user._id,
      organization: req.user.organizationId || null,
      visibility: b.visibility === "team" && req.user.organizationId ? "team" : "private",
      name,
      contractType: String(b.contractType ?? b.contract_type ?? "msa").slice(0, 60),
      jurisdiction: String(b.jurisdiction || "India (Indian Contract Act, 1872)").slice(0, 160),
      stance: ["protect_user_only", "user_favorable", "balanced"].includes(b.stance) ? b.stance : "balanced",
      version: String(b.version || "v1.0").slice(0, 24),
      fullText: fullText.slice(0, 200000),
      sections: Array.isArray(b.sections) ? b.sections.map(String).slice(0, 25) : [],
      presentationScore: Number(b.presentationScore ?? b.presentation_score ?? 90) || 90,
      notes: String(b.notes || "").slice(0, 600),
    });

    recordAudit(req, {
      action: "baseline_saved",
      resourceType: "baseline",
      resourceId: baseline._id,
      summary: `Saved contract baseline "${baseline.name}" (${baseline.version})`,
    });
    res.status(201).json({ message: "Gold-standard baseline saved.", baseline });
  } catch (err) {
    console.error("Save baseline error:", err.message);
    res.status(500).json({ message: "Failed to save baseline." });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Curated baselines cannot be deleted." });
    }
    const doc = await BaselineModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Baseline not found." });
    const isOwner = String(doc.user) === String(req.user._id);
    const isOrgAdmin =
      doc.organization &&
      req.user.organizationId &&
      String(doc.organization) === String(req.user.organizationId) &&
      ["admin", "counsel"].includes(req.user.role);
    if (!isOwner && !isOrgAdmin) return res.status(403).json({ message: "Unauthorized to delete this baseline." });

    await BaselineModel.findByIdAndDelete(doc._id);
    res.json({ message: "Baseline deleted." });
  } catch (err) {
    console.error("Delete baseline error:", err.message);
    res.status(500).json({ message: "Failed to delete baseline." });
  }
});

router.post("/:baselineId/benchmark", protect, aiLimiter, async (req, res) => {
  try {
    const { baselineId } = req.params;
    let baseline = CURATED_BASELINES.find((c) => c._id === baselineId) || null;
    if (!baseline) {
      if (!mongoose.Types.ObjectId.isValid(baselineId)) {
        return res.status(404).json({ message: "Baseline not found." });
      }
      baseline = await BaselineModel.findOne({ _id: baselineId, ...userBaselineFilter(req.user) }).lean();
      if (!baseline) return res.status(404).json({ message: "Baseline not found or unauthorized." });
    }

    const { contractId, documentId, targetTitle = "", targetText = "" } = req.body || {};
    const resolvedContractId = contractId || documentId || "";
    let resolvedTitle = String(targetTitle || "Draft Contract").trim();
    let resolvedText = String(targetText || "").trim();

    if (resolvedContractId) {
      if (!mongoose.Types.ObjectId.isValid(resolvedContractId)) {
        return res.status(400).json({ message: "Invalid contract ID." });
      }
      const doc = await DocumentModel.findById(resolvedContractId).select("+fullText");
      if (!doc) return res.status(404).json({ message: "Contract not found." });
      const isOwner = String(doc.user) === String(req.user._id);
      const isTeam = doc.visibility === "team" && doc.organization && req.user.organizationId && String(doc.organization) === String(req.user.organizationId);
      if (!isOwner && !isTeam) return res.status(403).json({ message: "Unauthorized access to target contract." });
      resolvedTitle = doc.title || doc.fileName;
      resolvedText = (doc.fullText || "").trim();
      if (resolvedText.length < 30) {
        const ClauseModel = require("../models/Clause");
        const clauses = await ClauseModel.find({ document: doc._id }).sort({ pageNumber: 1, createdAt: 1 }).lean();
        resolvedText = clauses.map((c) => `${c.sectionHeading || c.clauseType}\n${c.text}`).join("\n\n");
      }
    }

    if (resolvedText.length < 30) {
      return res.status(400).json({ message: "Target contract or draft text is too short to benchmark." });
    }

    const aiRes = await aiClient.request("/api/v1/baseline/benchmark", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 60000,
      body: {
        baseline_title: baseline.name,
        baseline_text: baseline.fullText,
        target_title: resolvedTitle,
        target_text: resolvedText.slice(0, 140000),
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Baseline benchmark failed.");
      return res.status(aiRes.status).json({ message: msg });
    }

    const result = await aiRes.json();
    recordAudit(req, {
      action: "baseline_benchmarked",
      resourceType: "baseline",
      resourceId: String(baseline._id),
      summary: `Benchmarked "${resolvedTitle}" against baseline "${baseline.name}" (${result.conformity_score}% conformity)`,
    });
    res.json(result);
  } catch (err) {
    console.error("Baseline benchmark error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to benchmark against baseline." });
  }
});

module.exports = router;
