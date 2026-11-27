const express = require("express");
const mongoose = require("mongoose");

const ClauseSnippetModel = require("../models/ClauseSnippet");
const { protect } = require("../middleware/authMiddleware");
const { recordAudit } = require("../utils/audit");

const router = express.Router();

const STARTER_CLAUSES = [
  {
    _id: "starter_liability_cap",
    isStarter: true,
    title: "Mutual 12-Month Fee Liability Cap & Carve-Outs",
    clauseType: "Limitation of Liability",
    stance: "balanced",
    jurisdiction: "India (ICA Sec. 73–74)",
    tags: ["liability", "cap", "consequential"],
    text: "Except for breaches of confidentiality, third-party intellectual property indemnification, data protection breaches, fraud, or willful misconduct, neither Party's aggregate liability arising out of or relating to this Agreement shall exceed the total fees paid or payable during the twelve (12) months immediately preceding the claim. Neither Party shall be liable for indirect, incidental, special, or consequential damages.",
  },
  {
    _id: "starter_conditional_ip",
    isStarter: true,
    title: "Payment-Conditioned IP Transfer & Background IP Carve-Out",
    clauseType: "Intellectual Property",
    stance: "vendor_favorable",
    jurisdiction: "India (Copyright Act Sec. 17 & 19)",
    tags: ["ip", "background-ip", "payment"],
    text: "Each Party retains exclusive ownership of its pre-existing intellectual property ('Background IP'). Ownership of custom Deliverables created specifically under an SOW shall transfer to Client strictly upon receipt of full cleared payment of all applicable fees, together with a perpetual, non-exclusive license to use any embedded Background IP solely to operate such Deliverables.",
  },
  {
    _id: "starter_client_acceptance",
    isStarter: true,
    title: "15-Day Written Acceptance Testing & Full Refund Right",
    clauseType: "Representations, Warranties & Covenants",
    stance: "client_favorable",
    jurisdiction: "India",
    tags: ["acceptance", "uat", "refund"],
    text: "Client shall have fifteen (15) Business Days following delivery to inspect and test each Deliverable against agreed specifications. Provider shall cure any documented non-conformity at its sole cost within ten (10) Business Days; failure to cure entitles Client to reject the Deliverable and receive a full refund of associated milestone fees within fifteen (15) days.",
  },
  {
    _id: "starter_no_autorenew",
    isStarter: true,
    title: "Strict Opt-In Written Renewal (Zero Auto-Renewal)",
    clauseType: "Renewal & Auto-Renewal",
    stance: "client_favorable",
    jurisdiction: "India (ICA Sec. 10)",
    tags: ["renewal", "no-evergreen"],
    text: "This Agreement shall not automatically renew. Any extension beyond the Initial Term requires express written confirmation executed by authorized signatories of both Parties at least thirty (30) days prior to expiration.",
  },
];

router.get("/", protect, async (req, res) => {
  try {
    const filter = req.user.organizationId
      ? { $or: [{ user: req.user._id }, { organization: req.user.organizationId, visibility: "team" }] }
      : { user: req.user._id };
    const saved = await ClauseSnippetModel.find(filter).sort({ updatedAt: -1 }).lean();
    res.json({ clauses: [...saved, ...STARTER_CLAUSES] });
  } catch (err) {
    console.error("List clause bank error:", err.message);
    res.status(500).json({ message: "Failed to load clause library." });
  }
});

router.post("/", protect, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim().slice(0, 160);
    const text = String(b.text || "").trim();
    if (!title || text.length < 20) {
      return res.status(400).json({ message: "Title and clause wording (at least 20 characters) are required." });
    }
    const snippet = await ClauseSnippetModel.create({
      user: req.user._id,
      organization: req.user.organizationId || null,
      visibility: b.visibility === "team" && req.user.organizationId ? "team" : "private",
      title,
      clauseType: String(b.clauseType || "General Provision").slice(0, 120),
      stance: ["protect_user_only", "user_favorable", "balanced", "client_favorable", "vendor_favorable"].includes(b.stance) ? b.stance : "balanced",
      jurisdiction: String(b.jurisdiction || "India").slice(0, 120),
      text: text.slice(0, 12000),
      tags: Array.isArray(b.tags) ? b.tags.map((t) => String(t).trim().slice(0, 32)).filter(Boolean).slice(0, 8) : [],
    });
    recordAudit(req, {
      action: "clause_bank_saved",
      resourceType: "clause_snippet",
      resourceId: snippet._id,
      summary: `Saved clause "${snippet.title}" to Approved Clause Library`,
    });
    res.status(201).json({ message: "Clause saved to library.", clause: snippet });
  } catch (err) {
    console.error("Save clause bank error:", err.message);
    res.status(500).json({ message: "Failed to save clause." });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Starter clauses cannot be deleted." });
    }
    const doc = await ClauseSnippetModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Clause not found." });
    if (String(doc.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Only the author can delete this saved clause." });
    }
    await ClauseSnippetModel.findByIdAndDelete(doc._id);
    res.json({ message: "Clause removed from library." });
  } catch (err) {
    console.error("Delete clause bank error:", err.message);
    res.status(500).json({ message: "Failed to delete clause." });
  }
});

module.exports = router;
