const mongoose = require("mongoose");

const missingClauseSchema = new mongoose.Schema(
  {
    clauseType: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "docx", "txt"],
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["uploaded", "processing", "completed", "failed"],
      default: "uploaded",
    },
    pageCount: {
      type: Number,
      default: 1,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    totalSections: {
      type: Number,
      default: 0,
    },
    vectorIndexed: {
      type: Boolean,
      default: false,
    },
    vectorCount: {
      type: Number,
      default: 0,
    },
    summary: {
      type: String,
      default: "",
    },
    keyFacts: {
      parties: { type: [String], default: [] },
      effectiveDate: { type: String, default: "Not specified" },
      expiryOrTerm: { type: String, default: "Not specified" },
      paymentTerms: { type: String, default: "Not specified" },
      noticePeriod: { type: String, default: "Not specified" },
      governingLaw: { type: String, default: "Not specified" },
      keyObligations: { type: [String], default: [] },
    },
    riskSummary: {
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
      overallLevel: { type: String, enum: ["low", "medium", "high"], default: "low" },
      score: { type: Number, default: 0 },
    },
    missingClauses: {
      type: [missingClauseSchema],
      default: [],
    },
    analysisProvider: {
      type: String,
      default: "",
    },
    extractedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

documentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);
