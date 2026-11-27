const mongoose = require("mongoose");

const missingClauseSchema = new mongoose.Schema(
  {
    clauseType: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const loopholeItemSchema = new mongoose.Schema(
  {
    loopholeId: { type: String, default: "" },
    title: { type: String, default: "" },
    category: { type: String, default: "ambiguous_standard" },
    severity: { type: String, enum: ["critical", "high", "medium", "low"], default: "medium" },
    location: { type: String, default: "General" },
    quotedExcerpt: { type: String, default: "" },
    whatCouldGoWrong: { type: String, default: "" },
    correctiveMeasure: { type: String, default: "" },
    scoreImpact: { type: Number, default: 6 },
    source: { type: String, default: "deterministic" },
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
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    visibility: {
      type: String,
      enum: ["private", "team"],
      default: "private",
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
      default: "",
    },
    storageProvider: {
      type: String,
      enum: ["local", "s3", "gridfs"],
      default: "local",
    },
    storageKey: {
      type: String,
      default: "",
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
      enum: ["uploaded", "queued", "processing", "completed", "failed"],
      default: "uploaded",
    },
    jobProgress: {
      stage: { type: String, default: "" },
      percent: { type: Number, default: 0 },
      message: { type: String, default: "" },
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
    ocrUsed: {
      type: Boolean,
      default: false,
    },
    vectorIndexed: {
      type: Boolean,
      default: false,
    },
    vectorCount: {
      type: Number,
      default: 0,
    },
    fullText: {
      type: String,
      default: "",
      select: false,
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
      obligationsAndDeadlines: {
        type: [
          new mongoose.Schema(
            {
              party: { type: String, default: "" },
              obligation: { type: String, default: "" },
              deadline: { type: String, default: "" },
              sourceRef: { type: String, default: "" },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },
    riskSummary: {
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
      overallLevel: { type: String, enum: ["low", "medium", "high"], default: "low" },
      score: { type: Number, default: 0 },
    },
    scorecard: {
      overallHealth: { type: Number, default: 0 },
      riskScore: { type: Number, default: 0 },
      loopholeScore: { type: Number, default: 100 },
      userFavorability: { type: Number, default: 50 },
      enforceabilityScore: { type: Number, default: 80 },
      projectedHealthAfterFixes: { type: Number, default: 85 },
      grade: { type: String, default: "B" },
      readinessVerdict: { type: String, default: "" },
      totalLoopholes: { type: Number, default: 0 },
      criticalLoopholes: { type: Number, default: 0 },
    },
    userPartyName: {
      type: String,
      default: "",
      trim: true,
    },
    userRole: {
      type: String,
      enum: [
        "neutral",
        "client_buyer",
        "vendor_seller",
        "employee",
        "employer",
        "tenant",
        "landlord",
        "contractor",
        "founder_investor",
      ],
      default: "neutral",
    },
    parentDocument: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      default: null,
    },
    loopholes: {
      type: [loopholeItemSchema],
      default: [],
    },
    negotiationBrief: {
      verdict: { type: String, default: "" },
      counterpartyPosture: { type: String, default: "" },
      topDealBreakers: { type: [String], default: [] },
      negotiationPriorities: { type: [String], default: [] },
      walkAwayRedLines: { type: [String], default: [] },
      tradeOffStrategy: { type: [String], default: [] },
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
documentSchema.index({ organization: 1, visibility: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);
