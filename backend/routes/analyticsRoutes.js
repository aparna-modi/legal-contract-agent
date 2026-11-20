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

    const [docs, qaList, feedbackRows, recentActivity] = await Promise.all([
      DocumentModel.find({ user: userId })
        .select("title fileName status riskSummary missingClauses totalTokens pageCount createdAt")
        .lean(),
      QuestionAnswerModel.find({ user: userId })
        .select("insufficientInformation confidence latencyMs")
        .lean(),
      FeedbackModel.aggregate([
        { $match: { user: userId } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),
      AuditLogModel.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(12)
        .select("action resourceType resourceId summary createdAt")
        .lean(),
    ]);

    const docIds = docs.map((d) => d._id);
    const clauses = docIds.length
      ? await ClauseModel.find({ document: { $in: docIds } })
          .select("clauseType riskLevel")
          .lean()
      : [];

    const analyzedDocs = docs.filter((d) => d.status === "completed");
    const avgRiskScore = analyzedDocs.length
      ? Math.round(
          analyzedDocs.reduce((sum, d) => sum + (d.riskSummary?.score || 0), 0) /
            analyzedDocs.length
        )
      : 0;

    // Aggregate risk distribution and per-category counts.
    const riskDistribution = { high: 0, medium: 0, low: 0 };
    const categoryMap = new Map();

    clauses.forEach((c) => {
      const level = ["high", "medium", "low"].includes(c.riskLevel) ? c.riskLevel : "low";
      riskDistribution[level] += 1;

      const cat = c.clauseType || "General Provision";
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { category: cat, total: 0, high: 0, medium: 0, low: 0 });
      }
      const entry = categoryMap.get(cat);
      entry.total += 1;
      entry[level] += 1;
    });

    const topCategories = Array.from(categoryMap.values())
      .sort((a, b) => b.high * 5 + b.medium * 2 + b.total - (a.high * 5 + a.medium * 2 + a.total))
      .slice(0, 8);

    // Aggregate missing protections across analyzed documents.
    const missingMap = new Map();
    analyzedDocs.forEach((doc) => {
      (doc.missingClauses || []).forEach((m) => {
        const key = m.clauseType;
        if (!key) return;
        if (!missingMap.has(key)) {
          missingMap.set(key, {
            clauseType: key,
            severity: m.severity || "medium",
            count: 0,
          });
        }
        missingMap.get(key).count += 1;
      });
    });

    const missingProtections = Array.from(missingMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Q&A + feedback quality stats.
    const totalQuestions = qaList.length;
    const refusalCount = qaList.filter((q) => q.insufficientInformation).length;
    const groundedCount = totalQuestions - refusalCount;
    const avgLatencyMs = totalQuestions
      ? Math.round(qaList.reduce((sum, q) => sum + (q.latencyMs || 0), 0) / totalQuestions)
      : 0;

    let feedbackUp = 0;
    let feedbackDown = 0;
    feedbackRows.forEach((row) => {
      if (row._id === "up") feedbackUp = row.count;
      if (row._id === "down") feedbackDown = row.count;
    });
    const totalFeedback = feedbackUp + feedbackDown;

    res.json({
      portfolio: {
        totalContracts: docs.length,
        analyzedContracts: analyzedDocs.length,
        pendingContracts: docs.length - analyzedDocs.length,
        avgRiskScore,
        totalClauses: clauses.length,
      },
      riskDistribution,
      topCategories,
      missingProtections,
      qaMetrics: {
        totalQuestions,
        groundedCount,
        refusalCount,
        avgLatencyMs,
        feedbackUp,
        feedbackDown,
        helpfulnessRate: totalFeedback > 0 ? Math.round((feedbackUp / totalFeedback) * 100) : null,
      },
      recentActivity,
    });
  } catch (error) {
    console.error("Analytics overview error:", error);
    res.status(500).json({ message: "Failed to load workspace analytics." });
  }
});

module.exports = router;
