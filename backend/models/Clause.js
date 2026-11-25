const mongoose = require("mongoose");

const clauseSchema = new mongoose.Schema(
  {
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    clauseType: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
    },
    pageNumber: {
      type: Number,
      default: 1,
    },
    sectionHeading: {
      type: String,
      default: "General",
      trim: true,
    },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    riskReason: {
      type: String,
      default: "",
    },
    plainEnglish: {
      type: String,
      default: "",
    },
    indianLawRef: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Clause", clauseSchema);
