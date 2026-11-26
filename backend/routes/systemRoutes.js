const express = require("express");
const mongoose = require("mongoose");
const { protect, requireRole } = require("../middleware/authMiddleware");
const { aiClient } = require("../utils/aiClient");
const { storageService } = require("../utils/storage");
const { getRedisStatus } = require("../utils/redisStore");
const { extractionQueue } = require("../utils/jobQueue");
const User = require("../models/User");
const DocumentModel = require("../models/Document");
const ClauseModel = require("../models/Clause");
const QuestionAnswerModel = require("../models/QuestionAnswer");
const FeedbackModel = require("../models/Feedback");
const AuditLogModel = require("../models/AuditLog");

const router = express.Router();

router.post("/warmup", protect, async (req, res) => {
  try {
    aiClient.ensureWarmBackground({ minIntervalMs: 30000 });
    const pool = aiClient.getPoolStatus();
    res.json({
      status: "ok",
      warming: true,
      aiPool: {
        totalNodes: pool.totalNodes,
        healthyNodes: pool.healthyNodes,
      },
    });
  } catch {
    res.json({ status: "ok", warming: true });
  }
});

router.get("/status", protect, async (req, res) => {
  try {
    const aiNodes = await aiClient.probeHealth();
    const pool = aiClient.getPoolStatus();
    res.json({
      service: "Legal Contract Agent API",
      version: "2.1.0",
      environment: process.env.NODE_ENV || "development",
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: mongoose.connection.readyState === 1 ? "connected" : "disconnected" },
      storage: { provider: storageService.getProviderName() },
      redis: getRedisStatus(),
      queue: extractionQueue.getQueueStats(),
      aiPool: {
        strategy: pool.strategy,
        totalNodes: pool.totalNodes,
        healthyNodes: aiNodes.filter((n) => n.reachable).length,
        nodes: aiNodes,
      },
      security: {
        authScheme: "Short-lived HS256 JWT + Rotating HttpOnly Refresh Tokens",
        tenantIsolation: "Strict MongoDB owner/team RBAC + tenant-scoped vector filtering",
        serviceAuth: Boolean((process.env.INTERNAL_API_KEY || "").trim()),
        role: req.user.role || "reviewer",
      },
    });
  } catch (err) {
    console.error("System status error:", err.message);
    res.status(500).json({ message: "Failed to retrieve system status." });
  }
});

function isPlatformAdmin(user) {
  if (!user || user.role !== "admin") return false;
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(String(user.email || "").trim().toLowerCase());
}

router.get("/admin/overview", protect, requireRole("admin"), async (req, res) => {
  try {
    // Only explicit PLATFORM_ADMIN_EMAILS see global cross-tenant data;
    // workspace admins are strictly scoped to their own organization/account.
    const globalScope = isPlatformAdmin(req.user);
    const userFilter = globalScope
      ? {}
      : req.user.organizationId
        ? { organizationId: req.user.organizationId }
        : { _id: req.user._id };

    const scopedUsers = await User.find(userFilter).select("_id").lean();
    const scopedUserIds = scopedUsers.map((u) => u._id);
    const docFilter = globalScope
      ? {}
      : req.user.organizationId
        ? { $or: [{ organization: req.user.organizationId }, { user: { $in: scopedUserIds } }] }
        : { user: req.user._id };
    const qaFilter = globalScope ? {} : { user: { $in: scopedUserIds } };
    const baseAuditFilter = globalScope ? {} : { user: { $in: scopedUserIds } };
    const auditFilter = { ...baseAuditFilter, action: { $ne: "token_refresh" } };

    const [users, roleAgg, docs, qaRows, fbRows, auditEntries, auditTotal, aiNodes] = await Promise.all([
      User.find(userFilter).sort({ createdAt: -1 }).limit(25).select("name email role organization lastLoginAt createdAt").lean(),
      User.aggregate([
        ...(Object.keys(userFilter).length ? [{ $match: userFilter }] : []),
        { $group: { _id: { $ifNull: ["$role", "reviewer"] }, count: { $sum: 1 } } },
      ]),
      DocumentModel.find(docFilter).select("_id status riskSummary createdAt").lean(),
      QuestionAnswerModel.find(qaFilter).select("insufficientInformation latencyMs").lean(),
      FeedbackModel.aggregate([
        ...(globalScope ? [] : [{ $match: { user: { $in: scopedUserIds } } }]),
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),
      AuditLogModel.find(auditFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user", "name email")
        .select("user action resourceType resourceId summary ipAddress createdAt")
        .lean(),
      AuditLogModel.countDocuments(auditFilter),
      aiClient.probeHealth(),
    ]);

    const totalClauses = docs.length
      ? await ClauseModel.countDocuments(globalScope ? {} : { document: { $in: docs.map((d) => d._id) } })
      : 0;
    const totalUsers = await User.countDocuments(userFilter);
    const roleCounts = roleAgg.reduce(
      (acc, r) => ({ ...acc, [r._id || "reviewer"]: r.count }),
      { admin: 0, counsel: 0, reviewer: 0 }
    );
    const analyzed = docs.filter((d) => d.status === "completed");
    const failed = docs.filter((d) => d.status === "failed").length;
    const avgRiskScore = analyzed.length
      ? Math.round(analyzed.reduce((s, d) => s + (d.riskSummary?.score || 0), 0) / analyzed.length)
      : 0;

    const totalQuestions = qaRows.length;
    const refusalCount = qaRows.filter((q) => q.insufficientInformation).length;
    const avgLatencyMs = totalQuestions ? Math.round(qaRows.reduce((s, q) => s + (q.latencyMs || 0), 0) / totalQuestions) : 0;
    const fbUp = fbRows.find((r) => r._id === "up")?.count || 0;
    const fbDown = fbRows.find((r) => r._id === "down")?.count || 0;
    const pool = aiClient.getPoolStatus();

    res.json({
      scope: globalScope ? "platform" : "workspace",
      users: { total: totalUsers, roles: roleCounts, accounts: users },
      contracts: {
        total: docs.length,
        analyzed: analyzed.length,
        pending: docs.length - analyzed.length - failed,
        failed,
        totalClauses,
        avgRiskScore,
      },
      quality: {
        totalQuestions,
        groundedCount: totalQuestions - refusalCount,
        refusalCount,
        avgLatencyMs,
        feedbackUp: fbUp,
        feedbackDown: fbDown,
        helpfulnessRate: fbUp + fbDown > 0 ? Math.round((fbUp / (fbUp + fbDown)) * 100) : null,
      },
      infrastructure: {
        database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        storage: storageService.getProviderName(),
        redis: getRedisStatus(),
        queue: extractionQueue.getQueueStats(),
        aiPool: { strategy: pool.strategy, totalNodes: pool.totalNodes, healthyNodes: aiNodes.filter((n) => n.reachable).length, nodes: aiNodes },
      },
      auditLogs: auditEntries,
      auditTotal,
    });
  } catch (err) {
    console.error("Admin overview error:", err.message);
    res.status(500).json({ message: "Failed to load admin overview." });
  }
});

router.get("/admin/audit", protect, requireRole("admin"), async (req, res) => {
  try {
    const globalScope = isPlatformAdmin(req.user);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const includeRoutine = String(req.query.includeRoutine || "").toLowerCase() === "true";

    let auditFilter = {};
    if (!globalScope) {
      const scopedUsers = req.user.organizationId
        ? await User.find({ organizationId: req.user.organizationId }).select("_id").lean()
        : [{ _id: req.user._id }];
      auditFilter = { user: { $in: scopedUsers.map((u) => u._id) } };
    }
    if (!includeRoutine) {
      auditFilter = { ...auditFilter, action: { $ne: "token_refresh" } };
    }

    const [total, entries] = await Promise.all([
      AuditLogModel.countDocuments(auditFilter),
      AuditLogModel.find(auditFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "name email")
        .select("user action resourceType resourceId summary ipAddress requestId createdAt")
        .lean(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      scope: globalScope ? "platform" : "workspace",
      page,
      limit,
      total,
      totalPages,
      count: entries.length,
      entries,
    });
  } catch (err) {
    console.error("Admin audit error:", err.message);
    res.status(500).json({ message: "Failed to retrieve admin audit logs." });
  }
});

module.exports = router;
