const mongoose = require("mongoose");

const baselineSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    contractType: {
      type: String,
      default: "msa",
      trim: true,
      maxlength: 60,
    },
    jurisdiction: {
      type: String,
      default: "India (Indian Contract Act, 1872)",
      trim: true,
      maxlength: 160,
    },
    stance: {
      type: String,
      enum: ["protect_user_only", "user_favorable", "balanced"],
      default: "balanced",
    },
    version: {
      type: String,
      default: "v1.0",
      trim: true,
      maxlength: 24,
    },
    fullText: {
      type: String,
      required: true,
    },
    sections: {
      type: [String],
      default: [],
    },
    presentationScore: {
      type: Number,
      default: 90,
    },
    notes: {
      type: String,
      default: "",
      maxlength: 600,
    },
  },
  {
    timestamps: true,
  }
);

baselineSchema.index({ user: 1, updatedAt: -1 });
baselineSchema.index({ organization: 1, visibility: 1, updatedAt: -1 });

module.exports = mongoose.model("Baseline", baselineSchema);
