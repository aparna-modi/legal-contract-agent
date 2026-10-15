const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const DocumentModel = require("../models/Document");
const ClauseModel = require("../models/Clause");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${Date.now()}-${sanitized}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".pdf", ".docx", ".txt"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Only .pdf, .docx, and .txt files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Upload contract
router.post("/upload", protect, (req, res) => {
  upload.single("contract")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File size exceeds 10MB limit" });
      }
      return res.status(400).json({ message: err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No contract file uploaded" });
    }

    try {
      const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
      const title = req.body.title && req.body.title.trim() ? req.body.title.trim() : req.file.originalname;

      const newDoc = await DocumentModel.create({
        user: req.user._id,
        title,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileType: ext,
        fileSize: req.file.size,
        status: "uploaded",
      });

      res.status(201).json({
        message: "Contract uploaded successfully",
        document: newDoc,
      });
    } catch (error) {
      console.error("Contract upload error:", error);
      res.status(500).json({ message: "Failed to save contract record" });
    }
  });
});

// List user's contracts
router.get("/", protect, async (req, res) => {
  try {
    const contracts = await DocumentModel.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ contracts });
  } catch (error) {
    console.error("List contracts error:", error);
    res.status(500).json({ message: "Failed to fetch contracts" });
  }
});

// Get single contract
router.get("/:id", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    res.json({ contract });
  } catch (error) {
    console.error("Get contract error:", error);
    res.status(500).json({ message: "Failed to fetch contract" });
  }
});

// Delete contract
router.delete("/:id", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    if (contract.filePath && fs.existsSync(contract.filePath)) {
      try {
        fs.unlinkSync(contract.filePath);
      } catch (fileErr) {
        console.warn("Could not delete physical file:", fileErr.message);
      }
    }

    // Cascade purge vectors from ChromaDB
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
    try {
      await fetch(`${aiServiceUrl}/api/v1/vector/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: req.user._id.toString(),
          document_id: contract._id.toString(),
        }),
      });
    } catch (vErr) {
      console.warn("Could not purge vector embeddings from ChromaDB:", vErr.message);
    }

    // Cascade delete associated clauses from MongoDB
    await ClauseModel.deleteMany({ document: contract._id });
    await DocumentModel.findByIdAndDelete(req.params.id);
    res.json({ message: "Contract, associated clauses, and vector embeddings deleted successfully" });
  } catch (error) {
    console.error("Delete contract error:", error);
    res.status(500).json({ message: "Failed to delete contract" });
  }
});

// Extract, parse contract text, persist clauses, and index into ChromaDB
router.post("/:id/extract", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    if (!contract.filePath || !fs.existsSync(contract.filePath)) {
      return res.status(404).json({ message: "Physical contract file not found on disk" });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
    const aiResponse = await fetch(`${aiServiceUrl}/api/v1/extract-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: contract.filePath,
        title: contract.fileName || contract.title,
        embed: true,
        user_id: req.user._id.toString(),
        document_id: contract._id.toString(),
        index_vector: true,
      }),
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}));
      return res.status(aiResponse.status).json({
        message: errorData.detail || "AI Service failed to parse contract",
      });
    }

    const extractionResult = await aiResponse.json();

    // 1. Idempotently clear previous clauses for this document
    await ClauseModel.deleteMany({ document: contract._id });

    // 2. Persist parsed and classified clauses into MongoDB Clause collection
    let clausesToInsert = [];
    if (extractionResult.classified_clauses && extractionResult.classified_clauses.length > 0) {
      clausesToInsert = extractionResult.classified_clauses.map((c) => ({
        document: contract._id,
        clauseType: c.clause_type || "General Provision",
        text: c.text,
        riskLevel: c.risk_level || "low",
        riskReason: c.risk_reason || "Standard contractual provision",
      }));
    } else {
      const chunks = extractionResult.chunks || [];
      clausesToInsert = chunks
        .filter((chunk) => chunk.text && chunk.text.trim().length > 30)
        .map((chunk) => {
          let clauseType = chunk.clause_type || chunk.section_heading || "General Provision";
          clauseType = clauseType.replace(/^\d+[\.\)]\s*/, "").trim() || "General Provision";

          return {
            document: contract._id,
            clauseType,
            text: chunk.text,
            riskLevel: chunk.risk_level || "low",
            riskReason: chunk.risk_reason || (chunk.section_heading ? `Extracted under '${chunk.section_heading}'` : "Standard agreement clause"),
          };
        });
    }

    if (clausesToInsert.length > 0) {
      await ClauseModel.insertMany(clausesToInsert);
    }

    // 3. Update contract status, extraction metrics, and vector index state
    contract.status = "completed";
    contract.pageCount = extractionResult.total_pages || 1;
    contract.totalTokens = extractionResult.total_tokens || 0;
    contract.totalSections = extractionResult.total_sections || 0;
    contract.vectorIndexed = true;
    contract.vectorCount = chunks.length;
    contract.extractedAt = new Date();
    await contract.save();

    res.json({
      message: "Contract parsed, clauses persisted, and vectors indexed into ChromaDB successfully",
      savedClausesCount: clausesToInsert.length,
      vectorsIndexedCount: chunks.length,
      document: contract,
      extraction: extractionResult,
    });
  } catch (error) {
    console.error("AI Service extraction error:", error);
    res.status(500).json({
      message: "Failed to communicate with AI Service. Ensure ai-service is running on port 8000.",
    });
  }

});

// Retrieve extracted clauses for a specific contract
router.get("/:id/clauses", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    const clauses = await ClauseModel.find({ document: contract._id }).sort({ createdAt: 1 });
    res.json({
      contractId: contract._id,
      title: contract.title,
      count: clauses.length,
      clauses,
    });
  } catch (error) {
    console.error("Get clauses error:", error);
    res.status(500).json({ message: "Failed to fetch contract clauses" });
  }
});

// Retrieve summary metadata for a contract
router.get("/:id/summary", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    const clauseCount = await ClauseModel.countDocuments({ document: contract._id });
    res.json({
      contract,
      metrics: {
        clauseCount,
        pageCount: contract.pageCount || 1,
        totalTokens: contract.totalTokens || 0,
        totalSections: contract.totalSections || 0,
        vectorIndexed: contract.vectorIndexed || false,
        vectorCount: contract.vectorCount || 0,
        status: contract.status,
      },
    });
  } catch (error) {
    console.error("Get contract summary error:", error);
    res.status(500).json({ message: "Failed to fetch contract summary" });
  }
});

// Grounded Contract Q&A via Retrieval Pipeline
router.post("/:id/ask", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid contract ID format" });
    }

    const contract = await DocumentModel.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    if (contract.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access to this contract" });
    }

    const { query, top_k = 5, min_score = 0.25, use_reranker = true } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ message: "Question query is required." });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
    const aiResponse = await fetch(`${aiServiceUrl}/api/v1/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        user_id: req.user._id.toString(),
        document_id: contract._id.toString(),
        top_k: Number(top_k),
        min_score: Number(min_score),
        use_reranker: Boolean(use_reranker),
      }),
    });

    if (!aiResponse.ok) {
      const errData = await aiResponse.json().catch(() => ({}));
      return res.status(aiResponse.status).json({
        message: errData.detail || "AI Service retrieval failed",
      });
    }

    const retrievalData = await aiResponse.json();
    res.json({
      contractId: contract._id,
      contractTitle: contract.title,
      fileName: contract.fileName,
      ...retrievalData,
    });
  } catch (error) {
    console.error("Contract Q&A error:", error);
    res.status(500).json({
      message: "Failed to perform contract Q&A retrieval",
      error: error.message,
    });
  }
});

// Library-wide cross-contract semantic search
router.post("/search", protect, async (req, res) => {
  try {
    const { query, top_k = 5, min_score = 0.20, use_reranker = true } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ message: "Search query is required." });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
    const aiResponse = await fetch(`${aiServiceUrl}/api/v1/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        user_id: req.user._id.toString(),
        top_k: Number(top_k),
        min_score: Number(min_score),
        use_reranker: Boolean(use_reranker),
      }),
    });

    if (!aiResponse.ok) {
      const errData = await aiResponse.json().catch(() => ({}));
      return res.status(aiResponse.status).json({
        message: errData.detail || "AI Service search failed",
      });
    }

    const searchData = await aiResponse.json();

    // Enrich results with contract title
    const docIds = [...new Set((searchData.results || []).map((r) => r.document_id).filter(Boolean))];
    const docs = await DocumentModel.find({ _id: { $in: docIds } }).select("title fileName");
    const docMap = {};
    docs.forEach((d) => {
      docMap[d._id.toString()] = { title: d.title, fileName: d.fileName };
    });

    if (searchData.results) {
      searchData.results = searchData.results.map((r) => ({
        ...r,
        contractTitle: docMap[r.document_id]?.title || "Contract Document",
        fileName: docMap[r.document_id]?.fileName || "",
      }));
    }

    res.json(searchData);
  } catch (error) {
    console.error("Library search error:", error);
    res.status(500).json({ message: "Failed to search contract library", error: error.message });
  }
});

// Vector store health and telemetry stats
router.get("/stats/vectors", protect, async (req, res) => {
  try {
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";
    const aiResponse = await fetch(
      `${aiServiceUrl}/api/v1/vector/stats?user_id=${req.user._id.toString()}`
    );
    if (!aiResponse.ok) {
      return res.status(502).json({ message: "Vector store service unavailable" });
    }
    const stats = await aiResponse.json();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve vector stats", error: error.message });
  }
});

module.exports = router;