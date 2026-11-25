const express = require("express");

const DocumentModel = require("../models/Document");
const ClauseModel = require("../models/Clause");
const QuestionAnswerModel = require("../models/QuestionAnswer");
const FeedbackModel = require("../models/Feedback");
const AuditLogModel = require("../models/AuditLog");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/overview", protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const docFilter = req.user.organizationId
      ? { $or: [{ user: userId }, { organization: req.user.organizationId, visibility: "team" }] }
      : { user: userId };
    const [docs, qaList, fbRows, recentActivity] = await Promise.all([
      DocumentModel.find(docFilter).select("title fileName status riskSummary missingClauses totalTokens pageCount createdAt").lean(),
      QuestionAnswerModel.find({ user: userId }).select("insufficientInformation confidence latencyMs").lean(),
      FeedbackModel.aggregate([{ $match: { user: userId } }, { $group: { _id: "$rating", count: { $sum: 1 } } }]),
      AuditLogModel.find({ user: userId }).sort({ createdAt: -1 }).limit(12).select("action resourceType resourceId summary createdAt").lean(),
    ]);

    const clauses = docs.length
      ? await ClauseModel.find({ document: { $in: docs.map((d) => d._id) } }).select("clauseType riskLevel").lean()
      : [];

    const analyzed = docs.filter((d) => d.status === "completed");
    const avgRiskScore = analyzed.length
      ? Math.round(analyzed.reduce((s, d) => s + (d.riskSummary?.score || 0), 0) / analyzed.length)
      : 0;

    const riskDistribution = { high: 0, medium: 0, low: 0 };
    const catMap = new Map();
    for (const c of clauses) {
      const lvl = ["high", "medium", "low"].includes(c.riskLevel) ? c.riskLevel : "low";
      riskDistribution[lvl] += 1;
      const cat = c.clauseType || "General Provision";
      const entry = catMap.get(cat) || { category: cat, total: 0, high: 0, medium: 0, low: 0 };
      entry.total += 1;
      entry[lvl] += 1;
      catMap.set(cat, entry);
    }
    const topCategories = [...catMap.values()]
      .sort((a, b) => b.high * 5 + b.medium * 2 + b.total - (a.high * 5 + a.medium * 2 + a.total))
      .slice(0, 8);

    const missingMap = new Map();
    for (const doc of analyzed) {
      for (const m of doc.missingClauses || []) {
        if (!m.clauseType) continue;
        const entry = missingMap.get(m.clauseType) || { clauseType: m.clauseType, severity: m.severity || "medium", count: 0 };
        entry.count += 1;
        missingMap.set(m.clauseType, entry);
      }
    }
    const missingProtections = [...missingMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);

    const totalQuestions = qaList.length;
    const refusalCount = qaList.filter((q) => q.insufficientInformation).length;
    const avgLatencyMs = totalQuestions ? Math.round(qaList.reduce((s, q) => s + (q.latencyMs || 0), 0) / totalQuestions) : 0;
    const feedbackUp = fbRows.find((r) => r._id === "up")?.count || 0;
    const feedbackDown = fbRows.find((r) => r._id === "down")?.count || 0;

    res.json({
      portfolio: {
        totalContracts: docs.length,
        analyzedContracts: analyzed.length,
        pendingContracts: docs.length - analyzed.length,
        avgRiskScore,
        totalClauses: clauses.length,
      },
      riskDistribution,
      topCategories,
      missingProtections,
      qaMetrics: {
        totalQuestions,
        groundedCount: totalQuestions - refusalCount,
        refusalCount,
        avgLatencyMs,
        feedbackUp,
        feedbackDown,
        helpfulnessRate: feedbackUp + feedbackDown > 0 ? Math.round((feedbackUp / (feedbackUp + feedbackDown)) * 100) : null,
      },
      recentActivity,
    });
  } catch (err) {
    console.error("Analytics overview error:", err.message);
    res.status(500).json({ message: "Failed to load workspace analytics." });
  }
});

module.exports = router;
