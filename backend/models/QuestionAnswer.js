const mongoose = require("mongoose");

const questionAnswerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      default: null,
      index: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      default: "",
    },
    citations: {
      type: [String],
      default: [],
    },
    indianLawRefs: {
      type: [String],
      default: [],
    },
    confidence: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW", "NONE"],
      default: "NONE",
    },
    insufficientInformation: {
      type: Boolean,
      default: false,
    },
    provider: {
      type: String,
      default: "",
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

questionAnswerSchema.index({ user: 1, document: 1, createdAt: -1 });

module.exports = mongoose.model("QuestionAnswer", questionAnswerSchema);
