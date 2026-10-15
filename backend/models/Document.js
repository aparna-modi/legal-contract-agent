const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    extractedAt: {
      type: Date,
    },

  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Document", documentSchema);