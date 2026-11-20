const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    questionAnswer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuestionAnswer",
      required: true,
    },
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      default: null,
    },
    rating: {
      type: String,
      enum: ["up", "down"],
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

feedbackSchema.index({ user: 1, questionAnswer: 1 }, { unique: true });

module.exports = mongoose.model("Feedback", feedbackSchema);
