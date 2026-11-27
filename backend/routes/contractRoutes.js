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
const { aiClient, extractAiErrorMessage } = require("../utils/aiClient");
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
    const detail = await extractAiErrorMessage(aiRes, "AI service failed to parse contract.");
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
    "Generating executive summary, counsel clause analysis, loophole scorecard, and Indian statutory references..."
  );
  let analysis = null;
  try {
    const res = await aiClient.request("/api/v1/analyze", {
      method: "POST",
      requestId: req?.requestId || "",
      timeoutMs: 110000,
      body: {
        document_name: contract.title || contract.fileName,
        full_text: ext.full_text || "",
        classified_clauses: ext.classified_clauses || [],
        user_party: contract.userPartyName || "",
        user_role: contract.userRole || "neutral",
      },
    });
    if (res.ok) analysis = await res.json();
  } catch (e) {
    console.warn("Summary analysis skipped:", e.message);
  }

  onProgress("classifying", 85, "Saving classified legal clauses, statutory links, and scorecard...");
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
      riskLevel: exp?.risk_level || c.risk_level || "low",
      riskReason:
        exp?.risk_reason ||
        c.risk_reason ||
        (c.section_heading ? `Extracted under '${c.section_heading}'.` : "Standard contractual provision."),
      plainEnglish: exp?.plain_english || c.plain_english || "",
      indianLawRef: exp?.indian_law_ref || c.indian_law_ref || "",
      ipcBnsRef: exp?.ipc_bns_ref || c.ipc_bns_ref || "",
    };
  });
  if (clauses.length) await ClauseModel.insertMany(clauses);

  const risk = analysis?.risk_summary || ext.risk_summary || {};
  const sc = analysis?.scorecard || {};
  const lps = Array.isArray(analysis?.loopholes) ? analysis.loopholes : [];
  const missing = analysis?.missing_clauses || ext.missing_clauses || [];
  const kf = analysis?.key_facts || {};
  const nb = analysis?.negotiation_brief || {};

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
    negotiationBrief: {
      verdict: String(nb.verdict || ""),
      counterpartyPosture: String(nb.counterparty_posture || ""),
      topDealBreakers: Array.isArray(nb.top_deal_breakers) ? nb.top_deal_breakers.map(String) : [],
      negotiationPriorities: Array.isArray(nb.negotiation_priorities) ? nb.negotiation_priorities.map(String) : [],
      walkAwayRedLines: Array.isArray(nb.walk_away_red_lines) ? nb.walk_away_red_lines.map(String) : [],
      tradeOffStrategy: Array.isArray(nb.trade_off_strategy) ? nb.trade_off_strategy.map(String) : [],
    },
    scorecard: {
      overallHealth: Number(sc.overall_health ?? Math.max(0, 100 - (risk.score || 0))) || 0,
      riskScore: Number(sc.risk_score ?? risk.score ?? 0) || 0,
      loopholeScore: Number(sc.loophole_score ?? 85) || 0,
      userFavorability: Number(sc.user_favorability ?? 60) || 0,
      enforceabilityScore: Number(sc.enforceability_score ?? 85) || 0,
      projectedHealthAfterFixes: Number(sc.projected_health_after_fixes ?? 92) || 92,
      grade: String(sc.grade || "B"),
      readinessVerdict: String(sc.readiness_verdict || ""),
      totalLoopholes: Number(sc.total_loopholes ?? lps.length) || 0,
      criticalLoopholes: Number(sc.critical_loopholes ?? 0) || 0,
    },
    loopholes: lps.map((lp) => ({
      loopholeId: String(lp.loophole_id || ""),
      title: String(lp.title || ""),
      category: String(lp.category || "ambiguous_standard"),
      severity: ["critical", "high", "medium", "low"].includes(lp.severity) ? lp.severity : "medium",
      location: String(lp.location || "General"),
      quotedExcerpt: String(lp.quoted_excerpt || ""),
      whatCouldGoWrong: String(lp.what_could_go_wrong || ""),
      correctiveMeasure: String(lp.corrective_measure || ""),
      scoreImpact: Number(lp.score_impact || 6),
      source: String(lp.source || "deterministic"),
    })),
    keyFacts: {
      parties: kf.parties || [],
      effectiveDate: kf.effective_date || "Not specified",
      expiryOrTerm: kf.expiry_or_term || "Not specified",
      paymentTerms: kf.payment_terms || "Not specified",
      noticePeriod: kf.notice_period || "Not specified",
      governingLaw: kf.governing_law || "Not specified",
      keyObligations: kf.key_obligations || [],
      obligationsAndDeadlines: Array.isArray(kf.obligations_and_deadlines)
        ? kf.obligations_and_deadlines.map((ob) => ({
            party: String(ob.party || "Contracting Party"),
            obligation: String(ob.obligation || ""),
            deadline: String(ob.deadline || "Ongoing"),
            sourceRef: String(ob.source_ref || ob.sourceRef || ""),
          }))
        : [],
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
    "> **Counsel Notice:** Prepared for pre-execution review and negotiation — obtain licensed legal counsel review prior to signing.",
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
  if (f.obligationsAndDeadlines?.length) {
    lines.push(
      "## Obligations & Deadlines",
      "| Party | Obligation | Deadline | Reference |",
      "| --- | --- | --- | --- |",
      ...f.obligationsAndDeadlines.map(
        (ob) =>
          `| ${String(ob.party || "Party").replace(/\|/g, "/")} | ${String(ob.obligation || "").replace(/\|/g, "/")} | ${String(ob.deadline || "Ongoing").replace(/\|/g, "/")} | ${String(ob.sourceRef || "—").replace(/\|/g, "/")} |`
      ),
      ""
    );
  }
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
    if (c.plainEnglish) lines.push(`- **Commercial Summary:** ${c.plainEnglish}`);
    if (c.indianLawRef) lines.push(`- **Applicable Indian Law:** ${c.indianLawRef}`);
    if (c.ipcBnsRef) lines.push(`- **IPC / BNS 2023 Reference:** ${c.ipcBnsRef}`);
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

      const ALLOWED_ROLES = new Set([
        "neutral", "client_buyer", "vendor_seller", "employee", "employer",
        "tenant", "landlord", "contractor", "founder_investor",
      ]);
      const doc = await DocumentModel.create({
        user: req.user._id,
        organization: req.user.organizationId || null,
        visibility: req.body.visibility === "team" && req.user.organizationId ? "team" : "private",
        title: req.body.title?.trim() ? req.body.title.trim().slice(0, 180) : req.file.originalname,
        userPartyName: req.body.userPartyName?.trim() ? req.body.userPartyName.trim().slice(0, 160) : "",
        userRole: ALLOWED_ROLES.has(req.body.userRole) ? req.body.userRole : "neutral",
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
    aiClient.ensureWarmBackground();
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
      timeoutMs: 90000,
      body: payload,
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "AI search request failed.");
      return res.status(aiRes.status).json({ message });
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
      timeoutMs: 90000,
      body: {
        contract_a_title: contractA.title || contractA.fileName,
        clauses_a: clausesA.map(toPayload),
        contract_b_title: contractB.title || contractB.fileName,
        clauses_b: clausesB.map(toPayload),
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "AI service failed to compare contracts.");
      return res.status(aiRes.status).json({ message });
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

const FALLBACK_DRAFT_TEMPLATES = [
  { id: "msa", label: "Master Services Agreement (MSA)", category: "Commercial", description: "Enterprise B2B services framework with SOWs, acceptance criteria, IP separation, liability cap, SLA, and exit handover.", default_term: "12 months from Effective Date", default_notice: "30 days prior written notice" },
  { id: "nda", label: "Non-Disclosure Agreement (NDA)", category: "Confidentiality", description: "Tightly drafted confidentiality deed protecting trade secrets, source code, pricing, and deal negotiations.", default_term: "3 years from Effective Date", default_notice: "15 days prior written notice" },
  { id: "saas", label: "SaaS Subscription Agreement", category: "Technology", description: "Cloud software subscription covering uptime SLA, service credits, DPDP/GDPR security, billing caps, and exit export.", default_term: "12 months (non-evergreen)", default_notice: "30 days prior written notice" },
  { id: "dpa", label: "Data Processing Agreement (DPA)", category: "Privacy & Compliance", description: "DPDP Act 2023 & GDPR-aligned processor obligations, 72-hour breach notice, sub-processors, and exit deletion.", default_term: "Co-terminous with Master Agreement", default_notice: "30 days prior written notice" },
  { id: "employment", label: "Employment Agreement", category: "HR & Talent", description: "Executive or full-time employment terms covering compensation, probation, IP ownership, confidentiality, and exit.", default_term: "Continuing until terminated", default_notice: "30 days prior written notice" },
  { id: "contractor", label: "Independent Contractor Agreement", category: "Commercial", description: "Consulting contract with milestones, conditional IP transfer on cleared payment, change orders, and kill fee.", default_term: "6 months or completion of milestones", default_notice: "14 days prior written notice" },
  { id: "lease", label: "Commercial Lease Agreement", category: "Real Estate", description: "Premises lease covering rent escalation cap, refundable security deposit, lock-in period, and peaceful handover.", default_term: "24 months from Commencement Date", default_notice: "60 days prior written notice" },
  { id: "sale_agreement", label: "Property Sale Agreement (Agreement to Sell)", category: "Real Estate", description: "Indian immovable property conveyance aligned with ToPA 1882, RERA 2016, 1% TDS (Sec. 194-IA), title indemnity, and Schedules.", default_term: "90 days to Sale Deed Registration", default_notice: "15 days written cure notice" },
  { id: "founders", label: "Founders & Shareholders Agreement (SHA)", category: "Corporate & Equity", description: "Equity allocation, 4-year vesting with 1-year cliff, IP assignment, ROFR, drag/tag-along, and reserved board matters.", default_term: "Continuing while Parties hold Equity", default_notice: "30 days prior written notice" },
  { id: "software_dev", label: "Software Development & Escrow Agreement", category: "Technology", description: "Custom engineering contract covering sprint milestones, UAT acceptance, source code transfer, OSS audit, and defect warranty.", default_term: "9 months + 90-day defect warranty", default_notice: "30 days prior written notice" },
  { id: "partnership", label: "Partnership / Joint Venture Agreement", category: "Corporate & Equity", description: "Structured under Indian Partnership Act, 1932 covering capital, profit/loss ratio, banking authority, and exit buyout.", default_term: "At-will or 5-year Joint Venture Term", default_notice: "60 days prior written notice" },
  { id: "settlement", label: "Settlement & Mutual Release Agreement", category: "Dispute Resolution", description: "Binding dispute closure with installment milestones, full & final release, withdrawal of proceedings, and non-disparagement.", default_term: "Effective upon cleared settlement sum", default_notice: "7 days cure notice on installment default" },
];

router.get("/draft/templates", protect, async (req, res) => {
  try {
    aiClient.ensureWarmBackground({ minIntervalMs: 30000 });
    const aiRes = await aiClient.request("/api/v1/draft/templates", {
      requestId: req.requestId,
      timeoutMs: 12000,
      waitForWakeup: false,
    });
    if (aiRes.ok) return res.json(await aiRes.json());
    return res.json({ templates: FALLBACK_DRAFT_TEMPLATES, source: "gateway-fallback" });
  } catch {
    return res.json({ templates: FALLBACK_DRAFT_TEMPLATES, source: "gateway-fallback" });
  }
});

router.post("/draft", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const contractType = b.contractType ?? b.contract_type ?? "msa";
    const title = b.title ?? "";
    const partyA = b.partyA ?? b.party_a ?? "";
    const partyB = b.partyB ?? b.party_b ?? "";
    const jurisdiction = b.jurisdiction ?? "India (Indian Contract Act, 1872)";
    const effectiveDate = b.effectiveDate ?? b.effective_date ?? "";
    const termDuration = b.termDuration ?? b.term_duration ?? "";
    const paymentTerms = b.paymentTerms ?? b.payment_terms ?? "";
    const noticePeriod = b.noticePeriod ?? b.notice_period ?? "";
    const specialInstructions = b.specialInstructions ?? b.special_instructions ?? "";
    const stance = b.stance ?? "balanced";
    const representingParty = b.representingParty ?? b.representing_party ?? "mutual";
    const templateDetails = b.templateDetails && typeof b.templateDetails === "object" ? b.templateDetails : (b.template_details || {});

    const aiRes = await aiClient.request("/api/v1/draft", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 140000,
      body: {
        contract_type: String(contractType).slice(0, 40),
        title: String(title).slice(0, 180),
        party_a: String(partyA).slice(0, 160),
        party_b: String(partyB).slice(0, 160),
        jurisdiction: String(jurisdiction).slice(0, 160),
        effective_date: String(effectiveDate).slice(0, 80),
        term_duration: String(termDuration).slice(0, 120),
        payment_terms: String(paymentTerms).slice(0, 400),
        notice_period: String(noticePeriod).slice(0, 120),
        special_instructions: String(specialInstructions).slice(0, 1500),
        stance: String(stance).slice(0, 40),
        representing_party: String(representingParty).slice(0, 32),
        template_details: templateDetails,
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "AI drafting request failed.");
      return res.status(aiRes.status).json({ message });
    }
    const draft = await aiRes.json();
    recordAudit(req, {
      action: "draft_generated",
      resourceType: "contract",
      summary: `Drafted "${draft.title || contractType}" (${draft.jurisdiction || jurisdiction})`,
    });
    res.json(draft);
  } catch (err) {
    console.error("Contract draft error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate contract draft." });
  }
});

router.post("/draft/revise", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "Contract Draft").slice(0, 200);
    const currentText = String(b.currentText ?? b.current_text ?? "").trim();
    const instruction = String(b.instruction || "").trim();
    const jurisdiction = String(b.jurisdiction || "India (Indian Contract Act, 1872)").slice(0, 160);
    if (currentText.length < 50) {
      return res.status(400).json({ message: "Current draft text is too short to revise." });
    }
    if (instruction.length < 5) {
      return res.status(400).json({ message: "Please provide a clear revision instruction." });
    }
    const aiRes = await aiClient.request("/api/v1/draft/revise", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        title,
        current_text: currentText.slice(0, 60000),
        instruction: instruction.slice(0, 1500),
        jurisdiction,
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "AI draft revision failed.");
      return res.status(aiRes.status).json({ message });
    }
    const revised = await aiRes.json();
    recordAudit(req, {
      action: "draft_revised",
      resourceType: "contract",
      summary: `Revised draft "${revised.title || title}" (${(revised.changes_made || []).length} changes)`,
    });
    res.json(revised);
  } catch (err) {
    console.error("Draft revision error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to revise contract draft." });
  }
});

router.post("/clauses/redline-adhoc", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const clauseType = String(b.clauseType ?? b.clause_type ?? "Commercial Clause").slice(0, 120);
    const clauseText = String(b.clauseText ?? b.clause_text ?? "").trim();
    const riskLevel = String(b.riskLevel ?? b.risk_level ?? "medium").slice(0, 20);
    const riskReason = String(b.riskReason ?? b.risk_reason ?? "").slice(0, 1000);
    const stance = String(b.stance || "balanced").slice(0, 32);
    const customInstruction = String(b.customInstruction ?? b.custom_instruction ?? "").slice(0, 600);
    if (!clauseText) return res.status(400).json({ message: "Clause text is required." });

    const aiRes = await aiClient.request("/api/v1/redline", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        clause_type: clauseType,
        clause_text: clauseText.slice(0, 10000),
        risk_level: riskLevel,
        risk_reason: riskReason,
        stance,
        custom_instruction: customInstruction,
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "Could not draft counter-redline.");
      return res.status(aiRes.status).json({ message });
    }
    const suggestion = await aiRes.json();
    recordAudit(req, {
      action: "redline_suggested",
      resourceType: "comparison",
      summary: `Generated counter-redline for "${clauseType}" (${stance})`,
    });
    res.json(suggestion);
  } catch (err) {
    console.error("Ad-hoc redline error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate counter-redline." });
  }
});

router.post("/draft/save", protect, uploadLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const title = b.title;
    const fullText = b.fullText ?? b.full_text ?? "";
    const autoAnalyze = b.autoAnalyze ?? b.auto_analyze ?? true;
    const visibility = b.visibility ?? "private";
    const cleanText = String(fullText || "").trim();
    if (cleanText.length < 50) {
      return res.status(400).json({ message: "Draft text must be at least 50 characters to save." });
    }
    if (cleanText.length > 500000) {
      return res.status(400).json({ message: "Draft text exceeds maximum allowed length." });
    }
    const cleanTitle = String(title || "Drafted Contract").trim().slice(0, 180) || "Drafted Contract";
    const safeFileBase = cleanTitle.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "draft_contract";
    const fileName = `${safeFileBase}.txt`;
    const buf = Buffer.from(cleanText, "utf8");

    const stored = await storageService.putObject({
      key: `${req.user._id}/${Date.now()}-${fileName}`,
      buffer: buf,
      contentType: "text/plain; charset=utf-8",
    });

    const doc = await DocumentModel.create({
      user: req.user._id,
      organization: req.user.organizationId || null,
      visibility: visibility === "team" && req.user.organizationId ? "team" : "private",
      title: cleanTitle,
      userPartyName: String(b.userPartyName || "").trim().slice(0, 160),
      userRole: b.userRole && [
        "neutral", "client_buyer", "vendor_seller", "employee", "employer",
        "tenant", "landlord", "contractor", "founder_investor",
      ].includes(b.userRole) ? b.userRole : "neutral",
      parentDocument: b.parentDocument && mongoose.Types.ObjectId.isValid(b.parentDocument) ? b.parentDocument : null,
      fileName,
      filePath: stored.filePath || "",
      storageProvider: stored.provider,
      storageKey: stored.storageKey,
      fileType: "txt",
      fileSize: buf.length,
      status: "uploaded",
    });

    recordAudit(req, {
      action: "upload",
      resourceType: "contract",
      resourceId: doc._id,
      summary: `Saved AI-drafted contract "${doc.title}" to workspace`,
    });

    if (autoAnalyze) {
      const result = await runExtraction(doc, req);
      return res.status(201).json({
        message: "Draft saved and analyzed in your workspace.",
        ...result,
      });
    }

    res.status(201).json({
      message: "Draft saved to your workspace.",
      document: sanitizeContractResponse(doc),
    });
  } catch (err) {
    console.error("Save draft error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to save contract draft." });
  }
});

function escapeIcsText(str = "") {
  return String(str).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function buildIcsCalendar(calName, items = []) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const baseDate = new Date(now.getTime() + 7 * 86400000);
  const events = items.map((item, idx) => {
    const dt = new Date(baseDate.getTime() + idx * 3 * 86400000);
    const ymd = dt.toISOString().slice(0, 10).replace(/-/g, "");
    const uid = `lca-deadline-${idx + 1}-${Date.now()}@legalcontractagent`;
    const summary = escapeIcsText(`${item.contractTitle || "Contract"}: ${item.obligation || "Obligation"}`);
    const desc = escapeIcsText(
      `Party: ${item.party || "Contracting Party"}\nDeadline / Trigger: ${item.deadline || "Per agreement"}\nSource Reference: ${item.sourceRef || "Contract"}`
    );
    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      "BEGIN:VALARM",
      "TRIGGER:-P7D",
      "ACTION:DISPLAY",
      `DESCRIPTION:Upcoming contract obligation: ${summary}`,
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Legal Contract Agent//Obligations Calendar//EN",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

router.post("/draft/audit-loopholes", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const draftText = String(b.draftText ?? b.full_text ?? "").trim();
    const documentName = String(b.title ?? b.documentName ?? "Initial Contract Draft").slice(0, 240);
    if (draftText.length < 30) {
      return res.status(400).json({ message: "Provide at least 30 characters of draft text to audit vulnerabilities." });
    }
    const aiRes = await aiClient.request("/api/v1/loopholes/audit", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 120000,
      body: {
        document_name: documentName,
        full_text: draftText.slice(0, 200000),
        classified_clauses: [],
        user_party: String(b.userParty || "").slice(0, 160),
        user_role: String(b.userRole || "neutral").slice(0, 40),
        mode: "hardening",
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to audit draft vulnerabilities.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const data = await aiRes.json();
    recordAudit(req, {
      action: "loophole_audit",
      resourceType: "draft",
      summary: `Audited initial draft "${documentName}" (${data.counts?.total || 0} vulnerabilities found)`,
    });
    res.json(data);
  } catch (err) {
    console.error("Draft loophole audit error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to audit draft vulnerabilities." });
  }
});

router.post("/draft/harden", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "Hardened Contract Draft").slice(0, 200);
    const draftText = String(b.draftText ?? b.draft_text ?? "").trim();
    const loopholesToFix = Array.isArray(b.loopholesToFix ?? b.loopholes_to_fix)
      ? (b.loopholesToFix ?? b.loopholes_to_fix).slice(0, 20)
      : [];
    const jurisdiction = String(b.jurisdiction || "India (Indian Contract Act, 1872)").slice(0, 160);
    if (draftText.length < 50) return res.status(400).json({ message: "Draft text is too short to harden." });
    if (!loopholesToFix.length) return res.status(400).json({ message: "Select at least one vulnerability resolution to apply." });

    const aiRes = await aiClient.request("/api/v1/draft/harden", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 140000,
      body: { title, draft_text: draftText.slice(0, 100000), loopholes_to_fix: loopholesToFix, jurisdiction },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to apply surgical hardening resolutions.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const data = await aiRes.json();
    recordAudit(req, {
      action: "draft_hardened",
      resourceType: "draft",
      summary: `Hardened draft "${title}" (${(data.resolutions_applied || []).length} loopholes sealed)`,
    });
    res.json(data);
  } catch (err) {
    console.error("Draft hardening error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to harden draft." });
  }
});

router.post("/draft/standardize-baseline", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "Standardized Baseline Agreement").slice(0, 200);
    const draftText = String(b.draftText ?? b.draft_text ?? "").trim();
    const jurisdiction = String(b.jurisdiction || "India (Indian Contract Act, 1872)").slice(0, 160);
    const contractType = String(b.contractType ?? b.contract_type ?? "msa").slice(0, 40);
    if (draftText.length < 50) return res.status(400).json({ message: "Draft text must be at least 50 characters to standardize." });

    const aiRes = await aiClient.request("/api/v1/draft/standardize-baseline", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 140000,
      body: { title, draft_text: draftText.slice(0, 100000), jurisdiction, contract_type: contractType },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Baseline standardization failed.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const data = await aiRes.json();
    recordAudit(req, {
      action: "baseline_standardized",
      resourceType: "baseline",
      summary: `Standardized presentation baseline for "${title}" (${data.after_baseline?.presentation_score || 0}% conformity)`,
    });
    res.json(data);
  } catch (err) {
    console.error("Baseline standardize error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to standardize presentation baseline." });
  }
});

router.post("/export-docx", protect, aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "Contract Agreement").slice(0, 240);
    const fullText = String(b.fullText ?? b.full_text ?? "").trim();
    if (fullText.length < 20) return res.status(400).json({ message: "Document text is too short to export." });

    const aiRes = await aiClient.request("/api/v1/export/docx", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 60000,
      body: {
        title,
        full_text: fullText.slice(0, 200000),
        subtitle: String(b.subtitle || "").slice(0, 200),
        jurisdiction: String(b.jurisdiction || "").slice(0, 160),
        document_kind: String(b.documentKind || "contract").slice(0, 40),
        counsel_notes: Array.isArray(b.counselNotes) ? b.counselNotes.map(String).slice(0, 20) : [],
        disclaimer: String(b.disclaimer || "").slice(0, 500),
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to generate Word (.docx) file.");
      return res.status(aiRes.status).json({ message: msg });
    }

    const buf = Buffer.from(await aiRes.arrayBuffer());
    const safeName = title.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "contract";
    recordAudit(req, {
      action: "export_docx",
      resourceType: "contract",
      summary: `Exported Word (.docx) manuscript "${title}"`,
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error("DOCX export error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate Word (.docx) export." });
  }
});

router.get("/deadlines/calendar.ics", protect, async (req, res) => {
  try {
    const filter = req.user.organizationId
      ? { status: "completed", $or: [{ user: req.user._id }, { organization: req.user.organizationId, visibility: "team" }] }
      : { status: "completed", user: req.user._id };
    const docs = await DocumentModel.find(filter).select("title fileName keyFacts.obligationsAndDeadlines").lean();
    const items = [];
    for (const d of docs) {
      for (const ob of d.keyFacts?.obligationsAndDeadlines || []) {
        if (ob?.obligation) {
          items.push({ contractTitle: d.title || d.fileName, ...ob });
        }
      }
    }
    const ics = buildIcsCalendar("Legal Contract Agent — Portfolio Deadlines", items.slice(0, 50));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contract_obligations_calendar.ics"');
    res.send(ics);
  } catch (err) {
    console.error("Portfolio ICS error:", err.message);
    res.status(500).json({ message: "Failed to export deadlines calendar." });
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

    const { stance = "balanced", customInstruction = "" } = req.body || {};
    const aiRes = await aiClient.request("/api/v1/redline", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        clause_type: clause.clauseType,
        clause_text: clause.text,
        risk_level: clause.riskLevel || "medium",
        risk_reason: clause.riskReason || "",
        playbook_guidance: matchedRule?.guidance || "",
        stance: String(stance || "balanced").slice(0, 32),
        custom_instruction: String(customInstruction || "").slice(0, 600),
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "Could not draft redline.");
      return res.status(aiRes.status).json({ message });
    }

    const suggestion = await aiRes.json();
    recordAudit(req, {
      action: "redline_suggested",
      resourceType: "clause",
      resourceId: clause._id,
      summary: `Generated ${stance} redline for "${clause.clauseType}" in "${contract.title}"`,
    });
    res.json({ clauseId: clause._id, ...suggestion });
  } catch (err) {
    console.error("Redline suggestion error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate clause redline suggestion." });
  }
});

router.post("/:id/draft-missing-clause", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;

    const { clauseType, reason = "" } = req.body || {};
    const cleanType = String(clauseType || "").trim().slice(0, 140);
    if (!cleanType) return res.status(400).json({ message: "clauseType is required." });

    const kf = contract.keyFacts || {};
    const aiRes = await aiClient.request("/api/v1/draft-clause", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        clause_type: cleanType,
        document_name: contract.title || contract.fileName,
        parties: Array.isArray(kf.parties) ? kf.parties.slice(0, 6) : [],
        jurisdiction: kf.governingLaw || "Not specified",
        reason: String(reason || "").slice(0, 600),
        existing_summary: String(contract.summary || "").slice(0, 1800),
      },
    });
    if (!aiRes.ok) {
      const message = await extractAiErrorMessage(aiRes, "Could not draft missing clause.");
      return res.status(aiRes.status).json({ message });
    }

    const drafted = await aiRes.json();
    recordAudit(req, {
      action: "missing_clause_drafted",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Drafted missing "${cleanType}" clause for "${contract.title}"`,
    });
    res.json({ contractId: contract._id, ...drafted });
  } catch (err) {
    console.error("Draft missing clause error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to draft missing clause." });
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

router.patch("/:id/perspective", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { requireWrite: true, includeFullText: true });
    if (!contract) return;
    const ALLOWED_ROLES = new Set([
      "neutral", "client_buyer", "vendor_seller", "employee", "employer",
      "tenant", "landlord", "contractor", "founder_investor",
    ]);
    const userPartyName = String(req.body?.userPartyName || "").trim().slice(0, 160);
    const userRole = ALLOWED_ROLES.has(req.body?.userRole) ? req.body.userRole : "neutral";
    contract.userPartyName = userPartyName;
    contract.userRole = userRole;

    // Refresh loophole scorecard for the selected party perspective
    if (contract.fullText && contract.fullText.length >= 20) {
      const clauses = await ClauseModel.find({ document: contract._id }).lean();
      try {
        const aiRes = await aiClient.request("/api/v1/loopholes/audit", {
          method: "POST",
          requestId: req.requestId,
          timeoutMs: 90000,
          body: {
            document_name: contract.title || contract.fileName,
            full_text: contract.fullText,
            classified_clauses: clauses.map((c) => ({
              clause_type: c.clauseType,
              text: c.text,
              risk_level: c.riskLevel,
              page_number: c.pageNumber,
              section_heading: c.sectionHeading,
            })),
            user_party: userPartyName,
            user_role: userRole,
            mode: "full_audit",
          },
        });
        if (aiRes.ok) {
          const audit = await aiRes.json();
          const sc = audit.scorecard || {};
          contract.scorecard = {
            overallHealth: Number(sc.overall_health || 0),
            riskScore: Number(sc.risk_score || 0),
            loopholeScore: Number(sc.loophole_score || 0),
            userFavorability: Number(sc.user_favorability || 0),
            enforceabilityScore: Number(sc.enforceability_score || 0),
            projectedHealthAfterFixes: Number(sc.projected_health_after_fixes || 0),
            grade: String(sc.grade || "B"),
            readinessVerdict: String(sc.readiness_verdict || ""),
            totalLoopholes: Number(sc.total_loopholes || 0),
            criticalLoopholes: Number(sc.critical_loopholes || 0),
          };
          contract.loopholes = (audit.loopholes || []).map((lp) => ({
            loopholeId: String(lp.loophole_id || ""),
            title: String(lp.title || ""),
            category: String(lp.category || "ambiguous_standard"),
            severity: ["critical", "high", "medium", "low"].includes(lp.severity) ? lp.severity : "medium",
            location: String(lp.location || "General"),
            quotedExcerpt: String(lp.quoted_excerpt || ""),
            whatCouldGoWrong: String(lp.what_could_go_wrong || ""),
            correctiveMeasure: String(lp.corrective_measure || ""),
            scoreImpact: Number(lp.score_impact || 6),
            source: String(lp.source || "deterministic"),
          }));
        }
      } catch (e) {
        console.warn("Perspective scorecard refresh warning:", e.message);
      }
    }

    await contract.save();
    recordAudit(req, {
      action: "perspective_updated",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Set party perspective on "${contract.title}" to ${userPartyName || userRole}`,
    });
    res.json({ message: "Represented party perspective updated.", document: sanitizeContractResponse(contract) });
  } catch (err) {
    console.error("Update perspective error:", err.message);
    res.status(500).json({ message: "Failed to update contract party perspective." });
  }
});

router.post("/:id/loopholes", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { includeFullText: true });
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 }).lean();
    const rawText = (contract.fullText || "").trim() || clauses.map((c) => c.text).join("\n\n");
    if (rawText.length < 20) return res.status(400).json({ message: "Analyze this contract before running a loophole audit." });

    const userParty = String(req.body?.userParty || contract.userPartyName || "").slice(0, 160);
    const userRole = String(req.body?.userRole || contract.userRole || "neutral").slice(0, 40);
    const mode = req.body?.mode === "hardening" ? "hardening" : "full_audit";

    const aiRes = await aiClient.request("/api/v1/loopholes/audit", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 120000,
      body: {
        document_name: contract.title || contract.fileName,
        full_text: rawText,
        classified_clauses: clauses.map((c) => ({
          clause_type: c.clauseType,
          text: c.text,
          risk_level: c.riskLevel,
          page_number: c.pageNumber,
          section_heading: c.sectionHeading,
        })),
        user_party: userParty,
        user_role: userRole,
        mode,
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Loophole audit failed.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const audit = await aiRes.json();
    const sc = audit.scorecard || {};
    await DocumentModel.findByIdAndUpdate(contract._id, {
      $set: {
        scorecard: {
          overallHealth: Number(sc.overall_health || 0),
          riskScore: Number(sc.risk_score || 0),
          loopholeScore: Number(sc.loophole_score || 0),
          userFavorability: Number(sc.user_favorability || 0),
          enforceabilityScore: Number(sc.enforceability_score || 0),
          projectedHealthAfterFixes: Number(sc.projected_health_after_fixes || 0),
          grade: String(sc.grade || "B"),
          readinessVerdict: String(sc.readiness_verdict || ""),
          totalLoopholes: Number(sc.total_loopholes || 0),
          criticalLoopholes: Number(sc.critical_loopholes || 0),
        },
        loopholes: (audit.loopholes || []).map((lp) => ({
          loopholeId: String(lp.loophole_id || ""),
          title: String(lp.title || ""),
          category: String(lp.category || "ambiguous_standard"),
          severity: ["critical", "high", "medium", "low"].includes(lp.severity) ? lp.severity : "medium",
          location: String(lp.location || "General"),
          quotedExcerpt: String(lp.quoted_excerpt || ""),
          whatCouldGoWrong: String(lp.what_could_go_wrong || ""),
          correctiveMeasure: String(lp.corrective_measure || ""),
          scoreImpact: Number(lp.score_impact || 6),
          source: String(lp.source || "deterministic"),
        })),
      },
    }).catch(() => {});

    recordAudit(req, {
      action: "loophole_audit",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Audited "${contract.title}" for loopholes (${audit.counts?.total || 0} found, health ${sc.overall_health || 0}/100)`,
    });
    res.json({ contractId: contract._id, ...audit });
  } catch (err) {
    console.error("Contract loophole audit error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to run loophole audit." });
  }
});

router.post("/:id/rewrite-user-only", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { includeFullText: true });
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 }).lean();
    const rawText = (contract.fullText || "").trim() || clauses.map((c) => c.text).join("\n\n");
    if (rawText.length < 30) return res.status(400).json({ message: "Analyze this contract before generating a user-protected rewrite." });

    const b = req.body || {};
    const userParty = String(b.userParty || contract.userPartyName || "").slice(0, 160);
    const userRole = String(b.userRole || (contract.userRole !== "neutral" ? contract.userRole : "client_buyer")).slice(0, 40);
    const aggressiveness = b.aggressiveness === "firm_negotiable" ? "firm_negotiable" : "maximum_user_only";
    const jurisdiction = String(b.jurisdiction || contract.keyFacts?.governingLaw || "India (Indian Contract Act, 1872)").slice(0, 160);
    const customPriorities = String(b.customPriorities || "").slice(0, 1500);

    const aiRes = await aiClient.request("/api/v1/contracts/rewrite-user-only", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 155000,
      body: {
        document_name: contract.title || contract.fileName,
        full_text: rawText,
        classified_clauses: clauses.map((c) => ({
          clause_type: c.clauseType,
          text: c.text,
          risk_level: c.riskLevel,
          page_number: c.pageNumber,
          section_heading: c.sectionHeading,
        })),
        user_party: userParty,
        user_role: userRole,
        aggressiveness,
        jurisdiction,
        custom_priorities: customPriorities,
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to rewrite contract in your favor.");
      return res.status(aiRes.status).json({ message: msg });
    }

    const result = await aiRes.json();
    recordAudit(req, {
      action: "protective_rewrite",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Generated user-protected rewrite of "${contract.title}" for ${userParty || userRole} (${aggressiveness})`,
    });
    res.json({ contractId: contract._id, ...result });
  } catch (err) {
    console.error("Protective rewrite error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate protective contract rewrite." });
  }
});

router.post("/:id/case-strategy", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res, { includeFullText: true });
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id }).sort({ pageNumber: 1, createdAt: 1 }).lean();
    const rawText = (contract.fullText || "").trim() || clauses.map((c) => c.text).join("\n\n");
    if (!clauses.length && rawText.length < 30) {
      return res.status(400).json({ message: "Analyze this contract before generating a litigation strategy brief." });
    }

    const b = req.body || {};
    const representedParty = String(b.representedParty || contract.userPartyName || (contract.keyFacts?.parties?.[0] || "")).slice(0, 160);
    const userRole = String(b.userRole || (contract.userRole !== "neutral" ? contract.userRole : "client_buyer")).slice(0, 40);
    const posture = b.posture === "defendant" ? "defendant" : "claimant";
    const disputeFacts = String(b.disputeFacts || "").slice(0, 3000);
    const jurisdiction = String(b.jurisdiction || contract.keyFacts?.governingLaw || "India").slice(0, 160);

    const aiRes = await aiClient.request("/api/v1/counsel/case-strategy", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 135000,
      body: {
        document_name: contract.title || contract.fileName,
        full_text: rawText,
        classified_clauses: clauses.map((c) => ({
          clause_type: c.clauseType,
          text: c.text,
          risk_level: c.riskLevel,
          page_number: c.pageNumber,
          section_heading: c.sectionHeading,
        })),
        represented_party: representedParty,
        user_role: userRole,
        posture,
        dispute_facts: disputeFacts,
        jurisdiction,
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to generate counsel case strategy.");
      return res.status(aiRes.status).json({ message: msg });
    }

    const strategy = await aiRes.json();
    recordAudit(req, {
      action: "case_strategy_generated",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Generated IPC/BNS litigation strategy for "${contract.title}" (${posture})`,
    });
    res.json({ contractId: contract._id, ...strategy });
  } catch (err) {
    console.error("Case strategy error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to generate litigation strategy." });
  }
});

router.post("/:id/legal-notice", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const clauses = await ClauseModel.find({ document: contract._id, riskLevel: { $in: ["high", "medium"] } }).limit(8).lean();
    const b = req.body || {};
    const kf = contract.keyFacts || {};
    const parties = Array.isArray(kf.parties) ? kf.parties : [];
    const representedParty = String(b.representedParty || contract.userPartyName || parties[0] || "").slice(0, 160);
    const fallbackCounter = parties.find((p) => p && p.toLowerCase() !== representedParty.toLowerCase()) || parties[1] || "";

    const aiRes = await aiClient.request("/api/v1/counsel/legal-notice", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 110000,
      body: {
        document_name: contract.title || contract.fileName,
        parties,
        effective_date: kf.effectiveDate || "",
        governing_law: kf.governingLaw || "India",
        represented_party: representedParty,
        counterparty_name: String(b.counterpartyName || fallbackCounter).slice(0, 160),
        dispute_facts: String(b.disputeFacts || "").slice(0, 3000),
        relief_sought: String(b.reliefSought || "").slice(0, 1000),
        notice_type: String(b.noticeType || "demand_and_cure").slice(0, 60),
        breached_clauses_summary: clauses.map((c) => `${c.clauseType} (Page ${c.pageNumber}): ${c.text.slice(0, 160)}`).join(" | "),
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to draft formal legal notice.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const notice = await aiRes.json();
    recordAudit(req, {
      action: "legal_notice_drafted",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Drafted formal legal notice for "${contract.title}"`,
    });
    res.json({ contractId: contract._id, ...notice });
  } catch (err) {
    console.error("Legal notice error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to draft formal legal notice." });
  }
});

router.post("/:id/negotiation-email", protect, aiLimiter, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const b = req.body || {};
    const kf = contract.keyFacts || {};
    const nb = contract.negotiationBrief || {};
    const parties = Array.isArray(kf.parties) ? kf.parties : [];
    const representedParty = String(b.representedParty || contract.userPartyName || parties[0] || "Our Team").slice(0, 160);
    const counterpartyName = String(
      b.counterpartyName || parties.find((p) => p && p.toLowerCase() !== representedParty.toLowerCase()) || "Counterparty Team"
    ).slice(0, 160);

    const aiRes = await aiClient.request("/api/v1/negotiation/email", {
      method: "POST",
      requestId: req.requestId,
      timeoutMs: 90000,
      body: {
        document_name: contract.title || contract.fileName,
        represented_party: representedParty,
        counterparty_name: counterpartyName,
        tone: String(b.tone || "collaborative").slice(0, 32),
        deal_breakers: Array.isArray(b.dealBreakers) ? b.dealBreakers : nb.topDealBreakers || [],
        negotiation_priorities: Array.isArray(b.negotiationPriorities) ? b.negotiationPriorities : nb.negotiationPriorities || [],
        accepted_redlines: Array.isArray(b.acceptedRedlines) ? b.acceptedRedlines.slice(0, 12) : [],
        custom_note: String(b.customNote || "").slice(0, 800),
      },
    });
    if (!aiRes.ok) {
      const msg = await extractAiErrorMessage(aiRes, "Failed to draft negotiation email.");
      return res.status(aiRes.status).json({ message: msg });
    }
    const data = await aiRes.json();
    recordAudit(req, {
      action: "negotiation_email_drafted",
      resourceType: "contract",
      resourceId: contract._id,
      summary: `Drafted ${b.tone || "collaborative"} pre-signing negotiation email for "${contract.title}"`,
    });
    res.json({ contractId: contract._id, ...data });
  } catch (err) {
    console.error("Negotiation email error:", err.message);
    res.status(err?.status || 500).json({ message: err?.status === 503 ? err.message : "Failed to draft negotiation email." });
  }
});

router.get("/:id/deadlines.ics", protect, async (req, res) => {
  try {
    const contract = await loadContract(req.params.id, req.user, res);
    if (!contract) return;
    const obs = (contract.keyFacts?.obligationsAndDeadlines || []).map((ob) => ({
      contractTitle: contract.title || contract.fileName,
      ...ob,
    }));
    const ics = buildIcsCalendar(`${contract.title || "Contract"} — Deadlines`, obs);
    const safeName = (contract.title || "contract").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50) || "contract";
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_deadlines.ics"`);
    res.send(ics);
  } catch (err) {
    console.error("Contract ICS error:", err.message);
    res.status(500).json({ message: "Failed to export contract deadlines." });
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

    const { query, question, top_k = 6, min_score = 0.22, use_reranker = true, history = [], qaMode = "facts" } = req.body || {};
    const q = String(query ?? question ?? "").trim().slice(0, 600);
    if (!q) return res.status(400).json({ message: "Question query is required." });

    const kVal = Math.min(20, Math.max(1, Number(top_k) || 6));
    const minVal = Math.min(1, Math.max(0, Number(min_score) || 0.22));
    const rerank = Boolean(use_reranker);
    const cleanQaMode = qaMode === "counsel_strategy" ? "counsel_strategy" : "facts";
    const cleanHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.query === "string")
          .slice(-6)
          .map((h) => ({ query: String(h.query).slice(0, 300), answer: String(h.answer || "").slice(0, 500) }))
      : [];

    const qHash = crypto.createHash("sha256").update(q.toLowerCase()).digest("hex").slice(0, 16);
    const cacheKey = `qa:v3:${cleanQaMode}:${contract._id}:${contract.extractedAt ? new Date(contract.extractedAt).getTime() : 0}:${qHash}:${kVal}:${minVal}:${rerank}`;

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
        qa_mode: cleanQaMode,
        conversation_history: cleanHistory.length ? cleanHistory : undefined,
      };

      let aiRes = await aiClient.request("/api/v1/retrieve", {
        method: "POST",
        requestId: req.requestId,
        timeoutMs: 90000,
        body: baseBody,
      });
      if (!aiRes.ok) {
        const message = await extractAiErrorMessage(aiRes, "AI retrieval request failed.");
        return res.status(aiRes.status).json({ message });
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
            timeoutMs: 90000,
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
