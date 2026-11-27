const mongoose = require("mongoose");

const clauseSnippetSchema = new mongoose.Schema(
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
      maxlength: 160,
    },
    clauseType: {
      type: String,
      default: "General Provision",
      trim: true,
      maxlength: 120,
    },
    stance: {
      type: String,
      enum: ["protect_user_only", "user_favorable", "balanced", "client_favorable", "vendor_favorable"],
      default: "balanced",
    },
    jurisdiction: {
      type: String,
      default: "India",
      trim: true,
      maxlength: 120,
    },
    text: {
      type: String,
      required: true,
      maxlength: 12000,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

clauseSnippetSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model("ClauseSnippet", clauseSnippetSchema);
