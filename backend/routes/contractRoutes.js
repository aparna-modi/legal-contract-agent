const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const DocumentModel = require("../models/Document");
const ClauseModel = require("../models/Clause");
const QuestionAnswerModel = require("../models/QuestionAnswer");
const FeedbackModel = require("../models/Feedback");
const PlaybookModel = require("../models/Playbook");
const { protect } = require("../middleware/authMiddleware");
const { aiLimiter, uploadLimiter } = require("../middleware/rateLimiters");
const { recordAudit } = require("../utils/audit");
const { aiClient } = require("../utils/aiClient");
const { storageService } = require("../utils/storage");
const { extractionQueue } = require("../utils/jobQueue");
const { cacheGetJson, cacheSetJson } = require("../utils/redisStore");
const { validateFileMagicBytes } = require("../utils/security");

const router = express.Router();
const uploadDir = storageService.LOCAL_UPLOAD_DIR;
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = [".pdf", ".docx", ".txt"];
const MIME_MAP = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`),
  }),
  fileFilter: (_, file, cb) => {
    const ok = ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Only .pdf, .docx, and .txt files are allowed."), ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const unlinkSafe = (p) => {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // Ignore cleanup errors on already-removed temp files.
  }
};

const sanitizeContractResponse = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.filePath;
  delete obj.fullText;
  return obj;
};

async function loadContract(id, user, res, { requireWrite = false, includeFullText = false } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "Invalid contract ID format." });
    return null;
  }
  const query = DocumentModel.findById(id);
  if (includeFullText) query.select("+fullText");
  const doc = await query;
  if (!doc) {
    res.status(404).json({ message: "Contract not found." });
    return null;
  }

  const isOwner = doc.user.toString() === user._id.toString();
  const isTeam =
    doc.visibility === "team" &&
    doc.organization &&
    user.organizationId &&
    doc.organization.toString() === user.organizationId.toString();

  if (!isOwner && !isTeam) {
    res.status(403).json({ message: "Unauthorized access to this contract." });
    return null;
  }
  if (requireWrite && !isOwner && !["admin", "counsel"].includes(user.role)) {
    res.status(403).json({ message: "Write access requires contract ownership or Counsel/Admin role." });
    return null;
  }
  return doc;
}

/**
 * Build vector-indexable chunk payloads from MongoDB Clauses (or fullText fallback)
 * so Q&A and library search self-heal automatically if the AI vector store restarts.
 */
async function buildStoredChunksForContract(contract) {
  const savedClauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 }).lean();
  if (savedClauses.length) {
    return savedClauses.map((c, idx) => ({
      chunk_id: String(c._id || `clause_${idx + 1}`),
      text: c.text,
      page_number: c.pageNumber || 1,
      section_heading: c.sectionHeading || "General",
      clause_type: c.clauseType || "General Provision",
    }));
  }

  const rawText = (contract.fullText || "").trim();
  if (!rawText) return [];

  const blocks = rawText
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 20);
  return blocks.map((text, idx) => ({
    chunk_id: `text_${idx + 1}`,
    text,
    page_number: 1,
    section_heading: "Contract Text",
    clause_type: "General Provision",
  }));
}

async function reindexContractFromMongo(contract, requestId = "") {
  const chunks = await buildStoredChunksForContract(contract);
  if (!chunks.length) return [];

  try {
    const idxRes = await aiClient.request("/api/v1/vector/index", {
      method: "POST",
      requestId,
      timeoutMs: 45000,
      body: {
        user_id: contract.user.toString(),
        document_id: contract._id.toString(),
        chunks,
        replace: true,
      },
    });
    if (idxRes.ok) {
      await DocumentModel.findByIdAndUpdate(contract._id, {
        $set: { vectorIndexed: true, vectorCount: chunks.length },
      }).catch(() => {});
    }
  } catch (err) {
    console.warn(`Self-healing reindex warning for contract ${contract._id}:`, err.message);
  }
  return chunks;
}

async function enqueueExtraction(contract, req, res) {
  contract.status = "queued";
  contract.jobProgress = { stage: "queued", percent: 5, message: "Queued for background extraction..." };
  await contract.save();
  const job = extractionQueue.enqueue({
    contractId: contract._id,
    userId: req.user._id,
    taskFn: (onProgress) => runExtraction(contract, req, onProgress),
  });
  return res.status(202).json({ message: "Contract queued for asynchronous analysis.", jobId: job.id, job });
}

async function runExtraction(contract, req, onProgress = () => {}) {
  contract.status = "processing";
  contract.jobProgress = { stage: "extracting", percent: 20, message: "Reading contract from storage..." };
  await contract.save();

  const fileBuffer = await storageService.getBuffer({
    storageProvider: contract.storageProvider || "local",
    storageKey: contract.storageKey,
    filePath: contract.filePath,
  });

  onProgress("extracting", 35, "Parsing pages, clauses, and embeddings on AI worker...");
  const aiRes = await aiClient.extractContractFile({
    buffer: fileBuffer,
    fileName: contract.fileName,
    title: contract.fileName || contract.title,
    userId: contract.user.toString(),
    documentId: contract._id.toString(),
    requestId: req?.requestId || "",
  });

  if (!aiRes.ok) {
    const errData = await aiRes.json().catch(() => ({}));
    const detail = errData.detail || "AI service failed to parse contract.";
    contract.status = "failed";
    contract.jobProgress = { stage: "failed", percent: 100, message: detail };
    await contract.save();
    const err = new Error(detail);
    err.status = aiRes.status;
    throw err;
  }

  const ext = await aiRes.json();
  const chunks = ext.chunks || [];

  onProgress(
    "analyzing",
    70,
    "Generating executive summary, plain-English explanations, and Indian law references..."
  );
  let analysis = null;
  try {
    const res = await aiClient.request("/api/v1/analyze", {
      method: "POST",
      requestId: req?.requestId || "",
      timeoutMs: 60000,
      body: {
        document_name: contract.title || contract.fileName,
        full_text: ext.full_text || "",
        classified_clauses: ext.classified_clauses || [],
      },
    });
    if (res.ok) analysis = await res.json();
  } catch (e) {
    console.warn("Summary analysis skipped:", e.message);
  }

  onProgress("classifying", 85, "Saving classified legal clauses and explanations...");
  await ClauseModel.deleteMany({ document: contract._id });

  const expByIdx = new Map((analysis?.clause_explanations || []).map((e) => [e.index, e]));
  const sourceList = ext.classified_clauses?.length
    ? ext.classified_clauses
    : chunks.filter((c) => c.text?.trim().length > 30);

  const clauses = sourceList.map((c, idx) => {
    const exp = expByIdx.get(idx);
    return {
      document: contract._id,
      clauseType:
        (c.clause_type || c.section_heading || "General Provision")
          .replace(/^\d+(?:\.\d+)*\s*[.)\-:]?\s*/, "")
          .trim() || "General Provision",
      text: c.text,
      pageNumber: c.page_number || 1,
      sectionHeading: c.section_heading || "General",
      riskLevel: c.risk_level || "low",
      riskReason:
        c.risk_reason ||
        (c.section_heading ? `Extracted under '${c.section_heading}'.` : "Standard contractual provision."),
      plainEnglish: exp?.plain_english || c.plain_english || "",
      indianLawRef: exp?.indian_law_ref || c.indian_law_ref || "",
    };
  });
  if (clauses.length) await ClauseModel.insertMany(clauses);

  const risk = analysis?.risk_summary || ext.risk_summary || {};
  const missing = analysis?.missing_clauses || ext.missing_clauses || [];
  const kf = analysis?.key_facts || {};

  Object.assign(contract, {
    status: "completed",
    jobProgress: { stage: "completed", percent: 100, message: "Analysis complete." },
    pageCount: ext.total_pages || 1,
    totalTokens: ext.total_tokens || 0,
    totalSections: ext.total_sections || 0,
    ocrUsed: Boolean(ext.metadata?.ocr_used),
    vectorIndexed: true,
    vectorCount: chunks.length,
    fullText: String(ext.full_text || "").slice(0, 450000),
    summary: analysis?.executive_summary || "",
    analysisProvider: analysis?.provider || "",
    keyFacts: {
      parties: kf.parties || [],
      effectiveDate: kf.effective_date || "Not specified",
      expiryOrTerm: kf.expiry_or_term || "Not specified",
      paymentTerms: kf.payment_terms || "Not specified",
      noticePeriod: kf.notice_period || "Not specified",
      governingLaw: kf.governing_law || "Not specified",
      keyObligations: kf.key_obligations || [],
    },
    riskSummary: {
      high: risk.high || 0,
      medium: risk.medium || 0,
      low: risk.low || 0,
      overallLevel: risk.overall_level || "low",
      score: risk.score || 0,
    },
    missingClauses: missing.map((m) => ({
      clauseType: m.clause_type,
      severity: m.severity || "medium",
      reason: m.reason || "",
    })),
    extractedAt: new Date(),
  });
  await contract.save();

  recordAudit(req, {
    userId: req?.user?._id || contract.user,
    action: "extract",
    resourceType: "contract",
    resourceId: contract._id,
    summary: `Analyzed "${contract.title}" (${clauses.length} clauses, risk score ${contract.riskSummary.score}/100)`,
  });

  return {
    savedClausesCount: clauses.length,
    vectorsIndexedCount: chunks.length,
    document: sanitizeContractResponse(contract),
    analysis,
    extraction: ext,
  };
}

function buildReportMarkdown(contract, clauses) {
  const f = contract.keyFacts || {};
  const r = contract.riskSummary || { high: 0, medium: 0, low: 0, overallLevel: "low", score: 0 };
  const lines = [
    `# Contract Analysis Report: ${contract.title}`,
    "",
    `- **Source File:** ${contract.fileName}`,
    `- **Analyzed At:** ${contract.extractedAt ? new Date(contract.extractedAt).toISOString() : "N/A"}`,
    `- **Pages / Sections / Tokens:** ${contract.pageCount || 1} pages | ${contract.totalSections || 0} sections | ${contract.totalTokens || 0} tokens`,
    `- **Overall Risk Rating:** ${(r.overallLevel || "low").toUpperCase()} (${r.score || 0}/100) — High: ${r.high || 0}, Medium: ${r.medium || 0}, Low: ${r.low || 0}`,
    "",
    "> **Disclaimer:** Generated by an AI-assisted review tool and does not constitute formal legal advice.",
    "",
    "## Executive Summary",
    contract.summary || "No executive summary generated.",
    "",
    "## Key Facts",
    `- **Parties:** ${f.parties?.length ? f.parties.join(", ") : "Not specified"}`,
    `- **Effective Date:** ${f.effectiveDate || "Not specified"}`,
    `- **Term / Expiry:** ${f.expiryOrTerm || "Not specified"}`,
    `- **Payment Terms:** ${f.paymentTerms || "Not specified"}`,
    `- **Notice Period:** ${f.noticePeriod || "Not specified"}`,
    `- **Governing Law:** ${f.governingLaw || "Not specified"}`,
    "",
  ];
  if (f.keyObligations?.length) {
    lines.push("## Key Obligations", ...f.keyObligations.map((o) => `- ${o}`), "");
  }
  if (contract.missingClauses?.length) {
    lines.push(
      "## Missing Core Clauses",
      ...contract.missingClauses.map((m) => `- **${m.clauseType}** (${(m.severity || "medium").toUpperCase()}): ${m.reason}`),
      ""
    );
  }
  lines.push(`## Extracted Clauses (${clauses.length})`, "");
  clauses.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.clauseType} — ${(c.riskLevel || "low").toUpperCase()} RISK`);
    lines.push(`- **Location:** Page ${c.pageNumber || 1}, Section: ${c.sectionHeading || "General"}`);
    if (c.plainEnglish) lines.push(`- **Plain-English Explanation:** ${c.plainEnglish}`);
    if (c.indianLawRef) lines.push(`- **Applicable Indian Law:** ${c.indianLawRef}`);
    if (c.riskReason) lines.push(`- **Risk Assessment:** ${c.riskReason}`);
    lines.push("", `> ${String(c.text || "").replace(/\n/g, "\n> ")}`, "");
  });
  return lines.join("\n");
}

// --- Static routes ---

router.post("/upload", protect, uploadLimiter, (req, res) => {
  upload.single("contract")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        message: err.code === "LIMIT_FILE_SIZE" ? "File size exceeds the 10MB limit." : err.message,
      });
    }
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No contract file was uploaded." });

    let stored = null;
    try {
      const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
      const sig = validateFileMagicBytes(req.file.path, ext);
      if (!sig.valid) {
        unlinkSafe(req.file.path);
        return res.status(400).json({ message: sig.message });
      }

      stored = await storageService.putObject({
        key: `${req.user._id}/${path.basename(req.file.path)}`,
        localPath: req.file.path,
        contentType: req.file.mimetype || MIME_MAP[ext] || "application/octet-stream",
      });

      const doc = await DocumentModel.create({
        user: req.user._id,
        organization: req.user.organizationId || null,
        visibility: req.body.visibility === "team" && req.user.organizationId ? "team" : "private",
        title: req.body.title?.trim() ? req.body.title.trim().slice(0, 180) : req.file.originalname,
        fileName: req.file.originalname,
        filePath: stored.filePath || "",
        storageProvider: stored.provider,
        storageKey: stored.storageKey,
        fileType: ext,
        fileSize: req.file.size,
        status: "uploaded",
      });

      recordAudit(req, {
        action: "upload",
        resourceType: "contract",
        resourceId: doc._id,
        summary: `Uploaded "${doc.title}" (${ext.toUpperCase()}, ${stored.provider})`,
      });

      res.status(201).json({
        message: "Contract uploaded successfully.",
        document: sanitizeContractResponse(doc),
      });
    } catch (error) {
      unlinkSafe(req.file?.path);
      if (stored?.storageKey) {
        await storageService
          .deleteObject({
            storageProvider: stored.provider,
            storageKey: stored.storageKey,
            filePath: stored.filePath,
          })
          .catch(() => {});
      }
      console.error("Contract upload error:", error);
      const userMessage = stored
        ? "Could not save contract record to the database. Please try again."
        : `Failed to store uploaded file: ${error.message || "storage service error"}`;
      res.status(error?.status || 500).json({ message: userMessage });
    }
  });
});

router.get("/", protect, async (req, res) => {
  try {
    const filter = req.user.organizationId
      ? { $or: [{ user: req.user._id }, { organization: req.user.organizationId, visibility: "team" }] }
      : { user: req.user._id };
    const contracts = await DocumentModel.find(filter).select("-filePath").sort({ createdAt: -1 });
    res.json({ contracts });
  } catch (err) {
    console.error("List contracts error:", err.message);
    res.status(500).json({ message: "Failed to fetch contracts." });
  }
});

router.get("/jobs/:jobId", protect, (req, res) => {
  const job = extractionQueue.getJob(req.params.jobId, req.user._id);
  return job ? res.json({ job }) : res.status(404).json({ message: "Extraction job not found." });
});

router.post("/search", protect, aiLimiter, async (req, res) => {
  const started = Date.now();
  try {
    const { query, top_k = 6, min_score = 0.2, use_reranker = true } = req.body || {};
    const q = String(query || "").trim().slice(0, 600);
    if (!q) return res.status(400).json({ message: "Search query is required." });

    const payload = {
      query: q,
      user_id: req.user._id.toString(),
      top_k: Math.min(20, Math.max(1, Number(top_k) || 6)),
      min_score: Math.min(1, Math.max(0, Number(min_score) || 0.2)),
      use_reranker: Boolean(use_reranker),
    };

    let aiRes = await aiClient.request("/api/v1/retrieve", {
      method: "POST",
      requestId: req.requestId,
      body: payload,
    });
    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(aiRes.status).json({ message: err.detail || "AI search request failed." });
    }

    let data = await aiRes.json();

    // Self-heal library search if vectors were cleared on an ephemeral AI worker restart.
    if (data.total_candidates === 0 || data.needs_reindex) {
      const completedDocs = await DocumentModel.find({ user: req.user._id, status: "completed" })
        .select("+fullText")
        .sort({ extractedAt: -1 })
        .limit(15);

      let reindexedAny = false;
      for (const doc of completedDocs) {
        const chunks = await reindexContractFromMongo(doc, req.requestId);
        if (chunks.length) reindexedAny = true;
      }

      if (reindexedAny) {
        aiRes = await aiClient.request("/api/v1/retrieve", {
          method: "POST",
          requestId: req.requestId,
          body: payload,
        });
        if (aiRes.ok) data = await aiRes.json();
      }
    }

    const ids = [...new Set((data.results || []).map((r) => r.document_id).filter(Boolean))];
    const docFilter = req.user.organizationId
      ? {
          _id: { $in: ids },
          $or: [{ user: req.user._id }, { organization: req.user.organizationId, visibility: "team" }],
        }
      : { _id: { $in: ids }, user: req.user._id };
    const docs = ids.length ? await DocumentModel.find(docFilter).select("title fileName").lean() : [];
    const map = new Map(docs.map((d) => [d._id.toString(), d]));

    if (data.results) {
      data.results = data.results.map((r) => ({
        ...r,
        contractTitle: map.get(r.document_id)?.title || "Contract Document",
        fileName: map.get(r.document_id)?.fileName || "",
      }));
    }

    const qa = await QuestionAnswerModel.create({
      user: req.user._id,
      document: null,
      query: q,
      answer: data.answer || "",
      citations: data.citations || [],
      indianLawRefs: data.indian_law_refs || [],
      confidence: data.confidence || "NONE",
      insufficientInformation: Boolean(data.insufficient_information),
      provider: data.provider || "",
      latencyMs: Date.now() - started,
    }).catch(() => null);

    recordAudit(req, { action: "search", resourceType: "library", summary: `Ran semantic search across contract library (${data.results?.length || 0} matches)` });
    res.json({ qaId: qa?._id || null, ...data });
  } catch (err) {
    console.error("Library search error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to search contract library." });
  }
});

router.post("/compare", protect, aiLimiter, async (req, res) => {
  try {
    const { contractAId, contractBId } = req.body || {};
    if (!contractAId || !contractBId) return res.status(400).json({ message: "Both contractAId and contractBId are required." });
    if (contractAId === contractBId) return res.status(400).json({ message: "Select two different contracts to compare." });

    const contractA = await loadContract(contractAId, req.user, res);
    if (!contractA) return;
    const contractB = await loadContract(contractBId, req.user, res);
    if (!contractB) return;

    const [clausesA, clausesB] = await Promise.all([
      ClauseModel.find({ document: contractA._id }).sort({ createdAt: 1 }).lean(),
      ClauseModel.find({ document: contractB._id }).sort({ createdAt: 1 }).lean(),
    ]);
    if (!clausesA.length || !clausesB.length) {
      return res.status(400).json({ message: "Both contracts must be analyzed before comparing them." });
    }

    const toPayload = (c) => ({
      clause_type: c.clauseType,
      text: c.text,
      risk_level: c.riskLevel,
      risk_reason: c.riskReason || "",
      page_number: c.pageNumber || 1,
      section_heading: c.sectionHeading || "General",
    });

    const aiRes = await aiClient.request("/api/v1/compare", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 60000,
      body: {
        contract_a_title: contractA.title || contractA.fileName,
        clauses_a: clausesA.map(toPayload),
        contract_b_title: contractB.title || contractB.fileName,
        clauses_b: clausesB.map(toPayload),
      },
    });
    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(aiRes.status).json({ message: err.detail || "AI service failed to compare contracts." });
    }

    const comparison = await aiRes.json();
    recordAudit(req, {
      action: "compare",
      resourceType: "comparison",
      resourceId: `${contractA._id}:${contractB._id}`,
      summary: `Compared "${contractA.title}" vs "${contractB.title}"`,
    });
    res.json({ contractAId: contractA._id, contractBId: contractB._id, ...comparison });
  } catch (err) {
    console.error("Contract comparison error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to compare contracts." });
  }
});

router.get("/stats/vectors", protect, async (req, res) => {
  try {
    const aiRes = await aiClient.request(`/api/v1/vector/stats?user_id=${encodeURIComponent(req.user._id)}`, {
      requestId: req.requestId,
      timeoutMs: 8000,
    });
    return aiRes.ok ? res.json(await aiRes.json()) : res.status(502).json({ message: "Vector store service unavailable." });
  } catch (err) {
    res.status(err?.status || 500).json({ message: "Failed to retrieve vector stats." });
  }
});

// --- Parameterized routes ---

router.get("/:id", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (contract) res.json({ contract: sanitizeContractResponse(contract) });
  } catch (err) {
    console.error("Get contract error:", err.message);
    res.status(500).json({ message: "Failed to fetch contract." });
  }
});

router.patch("/:id/visibility", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { requireWrite: true });
    if (!contract) return;
    const { visibility } = req.body || {};
    if (!["private", "team"].includes(visibility)) {
      return res.status(400).json({ message: "Visibility must be 'private' or 'team'." });
    }
    if (visibility === "team" && !req.user.organizationId) {
      return res.status(400).json({ message: "Join or initialize a team workspace before sharing contracts." });
    }
    contract.visibility = visibility;
    if (visibility === "team") contract.organization = req.user.organizationId;
    await contract.save();
    recordAudit(req, {
      action: "visibility_updated",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Set "${contract.title}" visibility to ${visibility.toUpperCase()}`,
    });
    res.json({ message: `Contract visibility updated to ${visibility}.`, visibility });
  } catch (err) {
    console.error("Visibility update error:", err.message);
    res.status(500).json({ message: "Failed to update contract visibility." });
  }
});

router.get("/:id/file", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const buf = await storageService.getBuffer({
      storageProvider: contract.storageProvider || "local",
      storageKey: contract.storageKey,
      filePath: contract.filePath,
    });
    res.setHeader("Content-Type", MIME_MAP[contract.fileType] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(contract.fileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buf);
  } catch (err) {
    console.error("Stream contract file error:", err.message);
    res.status(err?.status || 500).json({ message: err?.message || "Failed to retrieve contract file." });
  }
});

router.get("/:id/events", protect, async (req, res) => {
  const contract = await loadContract(req.params.id, req.user, res);
  if (!contract) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({
      contractId: contract._id,
      status: contract.status,
      stage: contract.jobProgress?.stage || contract.status,
      percent: contract.jobProgress?.percent || (contract.status === "completed" ? 100 : 0),
      message: contract.jobProgress?.message || "",
    })}\n\n`
  );

  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15000);
  const unsub = extractionQueue.subscribe(contract._id.toString(), (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (["completed", "failed"].includes(payload.status)) {
      clearInterval(keepAlive);
      unsub();
      res.end();
    }
  });
  req.on("close", () => {
    clearInterval(keepAlive);
    unsub();
  });
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { requireWrite: true });
    if (!contract) return;

    await storageService.deleteObject({
      storageProvider: contract.storageProvider || "local",
      storageKey: contract.storageKey,
      filePath: contract.filePath,
    });
    await aiClient
      .request("/api/v1/vector/delete", {
        method: "POST",
        requestId: req.requestId,
        timeoutMs: 10000,
        body: { user_id: contract.user.toString(), document_id: contract._id.toString() },
      })
      .catch((e) => console.warn("Vector purge skipped:", e.message));

    await Promise.all([
      ClauseModel.deleteMany({ document: contract._id }),
      QuestionAnswerModel.deleteMany({ document: contract._id }),
      FeedbackModel.deleteMany({ document: contract._id }),
      DocumentModel.findByIdAndDelete(req.params.id),
    ]);
    recordAudit(req, {
      action: "delete",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Deleted "${contract.title}" and purged indexed vectors`,
    });
    res.json({ message: "Contract, clauses, Q&A history, and vector embeddings deleted." });
  } catch (err) {
    console.error("Delete contract error:", err.message);
    res.status(500).json({ message: "Failed to delete contract." });
  }
});

router.post("/:id/extract-async", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { requireWrite: true });
    if (contract) await enqueueExtraction(contract, req, res);
  } catch (err) {
    console.error("Async extraction enqueue error:", err.message);
    res.status(500).json({ message: "Failed to enqueue contract analysis." });
  }
});

router.post("/:id/extract", protect, aiLimiter, async (req, res) => {
  let contract = null;
  try {
    contract = await loadContract(req.params.id, req.user, res, { requireWrite: true });
    if (!contract) return;
    if (req.query.async === "true") return await enqueueExtraction(contract, req, res);
    const result = await runExtraction(contract, req);
    res.json({ message: "Contract analyzed, clauses saved, and vectors indexed successfully.", ...result });
  } catch (err) {
    console.error("AI extraction error:", err.message);
    if (contract && contract.status !== "failed") {
      contract.status = "failed";
      await contract.save().catch(() => {});
    }
    res.status(err?.status || 500).json({
      message: [400, 404, 503].includes(err?.status)
        ? err.message
        : "Failed to communicate with AI service. Ensure ai-service is healthy.",
    });
  }
});

router.get("/:id/clauses", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 });
    res.json({ contractId: contract._id, title: contract.title, count: clauses.length, clauses });
  } catch (err) {
    console.error("Get clauses error:", err.message);
    res.status(500).json({ message: "Failed to fetch contract clauses." });
  }
});

router.post("/:id/clauses/:clauseId/suggest-redline", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.clauseId)) {
      return res.status(400).json({ message: "Invalid clause ID." });
    }

    const clause = await ClauseModel.findOne({ _id: req.params.clauseId, document: contract._id });
    if (!clause) return res.status(404).json({ message: "Clause not found." });

    const pb = await PlaybookModel.findOne(
      req.user.organizationId
        ? { $or: [{ organization: req.user.organizationId }, { user: req.user._id }] }
        : { user: req.user._id }
    ).lean();
    const matchedRule = (pb?.rules || []).find(
      (r) =>
        r.enabled &&
        r.guidance &&
        r.ruleType === "require_clause" &&
        (clause.clauseType.toLowerCase().includes(r.target.toLowerCase()) ||
          r.name.toLowerCase().includes(clause.clauseType.toLowerCase()))
    );

    const aiRes = await aiClient.request("/api/v1/redline", {
      method: "POST",
      requestId: req.requestId,
      body: {
        clause_type: clause.clauseType,
        clause_text: clause.text,
        risk_level: clause.riskLevel || "medium",
        risk_reason: clause.riskReason || "",
        playbook_guidance: matchedRule?.guidance || "",
      },
    });
    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(aiRes.status).json({ message: err.detail || "Could not draft redline." });
    }

    const suggestion = await aiRes.json();
    recordAudit(req, {
      action: "redline_suggested",
      resourceType: "clause",
      resourceId: clause._id,
      summary: `Generated fallback redline for "${clause.clauseType}" in "${contract.title}"`,
    });
    res.json({ clauseId: clause._id, ...suggestion });
  } catch (err) {
    console.error("Redline suggestion error:", err.message);
    res.status(err?.status || 500).json({ message: "Failed to generate clause redline suggestion." });
  }
});

router.get("/:id/risks", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const flagged = await ClauseModel.find({
      document: contract._id,
      riskLevel: { $in: ["high", "medium"] },
    }).sort({ createdAt: 1 });
    flagged.sort((a, b) => (a.riskLevel === "high" ? -1 : 1) - (b.riskLevel === "high" ? -1 : 1));
    res.json({
      contractId: contract._id,
      title: contract.title,
      riskSummary: contract.riskSummary || { high: 0, medium: 0, low: 0, overallLevel: "low", score: 0 },
      flaggedCount: flagged.length,
      flaggedClauses: flagged,
      missingClauses: contract.missingClauses || [],
    });
  } catch (err) {
    console.error("Get contract risks error:", err.message);
    res.status(500).json({ message: "Failed to fetch contract risk analysis." });
  }
});

router.get("/:id/qa", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const history = await QuestionAnswerModel.find({ user: req.user._id, document: contract._id })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();
    const fbs = history.length
      ? await FeedbackModel.find({ user: req.user._id, questionAnswer: { $in: history.map((h) => h._id) } }).lean()
      : [];
    const fbMap = new Map(fbs.map((f) => [f.questionAnswer.toString(), { rating: f.rating, comment: f.comment }]));
    const items = history.map((h) => ({ ...h, feedback: fbMap.get(h._id.toString()) || null }));
    res.json({ contractId: contract._id, count: items.length, history: items });
  } catch (err) {
    console.error("Get Q&A history error:", err.message);
    res.status(500).json({ message: "Failed to fetch Q&A history." });
  }
});

router.get("/:id/summary", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const clauseCount = await ClauseModel.countDocuments({ document: contract._id });
    res.json({
      contract: sanitizeContractResponse(contract),
      metrics: {
        clauseCount,
        pageCount: contract.pageCount || 1,
        totalTokens: contract.totalTokens || 0,
        totalSections: contract.totalSections || 0,
        ocrUsed: Boolean(contract.ocrUsed),
        vectorIndexed: Boolean(contract.vectorIndexed),
        vectorCount: contract.vectorCount || 0,
        status: contract.status,
        riskSummary: contract.riskSummary,
      },
    });
  } catch (err) {
    console.error("Get summary error:", err.message);
    res.status(500).json({ message: "Failed to fetch contract summary." });
  }
});

router.get("/:id/report", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 });
    const safeName =
      (contract.title || "contract")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "contract";
    recordAudit(req, {
      action: "export_report",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Exported Markdown report for "${contract.title}"`,
    });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_analysis_report.md"`);
    res.send(buildReportMarkdown(contract, clauses));
  } catch (err) {
    console.error("Report generation error:", err.message);
    res.status(500).json({ message: "Failed to generate analysis report." });
  }
});

router.post("/:id/ask", protect, aiLimiter, async (req, res) => {
  const started = Date.now();
  try {
    const contract = await loadContract(req.params.id, req.user, res, { includeFullText: true });
    if (!contract) return;

    const { query, top_k = 6, min_score = 0.22, use_reranker = true, history = [] } = req.body || {};
    const q = String(query || "").trim().slice(0, 600);
    if (!q) return res.status(400).json({ message: "Question query is required." });

    const kVal = Math.min(20, Math.max(1, Number(top_k) || 6));
    const minVal = Math.min(1, Math.max(0, Number(min_score) || 0.22));
    const rerank = Boolean(use_reranker);
    const cleanHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.query === "string")
          .slice(-4)
          .map((h) => ({ query: String(h.query).slice(0, 300), answer: String(h.answer || "").slice(0, 500) }))
      : [];

    const qHash = crypto.createHash("sha256").update(q.toLowerCase()).digest("hex").slice(0, 16);
    const cacheKey = `qa:v2:${contract._id}:${contract.extractedAt ? new Date(contract.extractedAt).getTime() : 0}:${qHash}:${kVal}:${minVal}:${rerank}`;

    let data = cleanHistory.length === 0 ? await cacheGetJson(cacheKey) : null;
    const cached = Boolean(data);

    if (!data) {
      const baseBody = {
        query: q,
        user_id: contract.user.toString(),
        document_id: contract._id.toString(),
        document_title: contract.title || contract.fileName,
        top_k: kVal,
        min_score: minVal,
        use_reranker: rerank,
        conversation_history: cleanHistory.length ? cleanHistory : undefined,
      };

      let aiRes = await aiClient.request("/api/v1/retrieve", {
        method: "POST",
        requestId: req.requestId,
        body: baseBody,
      });
      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({}));
        return res.status(aiRes.status).json({ message: err.detail || "AI retrieval request failed." });
      }
      data = await aiRes.json();

      // Self-heal automatically if the AI vector store was wiped (e.g., Render free tier restart)
      // by re-indexing saved MongoDB clauses/text and retrying seamlessly.
      if (data.total_candidates === 0 || data.needs_reindex) {
        const storedChunks = await reindexContractFromMongo(contract, req.requestId);
        if (storedChunks.length) {
          aiRes = await aiClient.request("/api/v1/retrieve", {
            method: "POST",
            requestId: req.requestId,
            body: {
              ...baseBody,
              fallback_chunks: storedChunks,
            },
          });
          if (aiRes.ok) data = await aiRes.json();
        }
      }

      // Only cache valid responses (never cache empty-index errors).
      if (cleanHistory.length === 0 && (data.total_candidates || 0) > 0 && !data.needs_reindex) {
        await cacheSetJson(cacheKey, data, 600);
      }
    }

    const latencyMs = Date.now() - started;
    const qa = await QuestionAnswerModel.create({
      user: req.user._id,
      document: contract._id,
      query: q,
      answer: data.answer || "",
      citations: data.citations || [],
      indianLawRefs: data.indian_law_refs || [],
      confidence: data.confidence || "NONE",
      insufficientInformation: Boolean(data.insufficient_information),
      provider: data.provider || "",
      latencyMs,
    }).catch(() => null);

    recordAudit(req, {
      action: "ask",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Asked question on "${contract.title}"${cached ? " (cached)" : ""}`,
    });
    res.json({
      qaId: qa?._id || null,
      contractId: contract._id,
      contractTitle: contract.title,
      fileName: contract.fileName,
      latencyMs,
      cached,
      ...data,
    });
  } catch (err) {
    console.error("Contract Q&A error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to run contract Q&A." });
  }
});

module.exports = router;
