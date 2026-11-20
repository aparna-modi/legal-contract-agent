const express = require("express");
const mongoose = require("mongoose");

const FeedbackModel = require("../models/Feedback");
const QuestionAnswerModel = require("../models/QuestionAnswer");
const { protect } = require("../middleware/authMiddleware");
const { recordAudit } = require("../utils/audit");

const router = express.Router();

router.post("/", protect, async (req, res) => {
  try {
    const { qaId, rating, comment = "" } = req.body;

    if (!qaId || !mongoose.Types.ObjectId.isValid(qaId)) {
      return res.status(400).json({ message: "A valid qaId is required." });
    }
    if (!["up", "down"].includes(rating)) {
      return res.status(400).json({ message: "Rating must be 'up' or 'down'." });
    }

    const qaRecord = await QuestionAnswerModel.findById(qaId);
    if (!qaRecord) {
      return res.status(404).json({ message: "Q&A answer record not found." });
    }
    if (qaRecord.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized to rate this answer." });
    }

    const feedback = await FeedbackModel.findOneAndUpdate(
      { user: req.user._id, questionAnswer: qaRecord._id },
      {
        user: req.user._id,
        questionAnswer: qaRecord._id,
        document: qaRecord.document || null,
        rating,
        comment: String(comment || "").trim().slice(0, 500),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    recordAudit(req, {
      action: "feedback",
      resourceType: "qa",
      resourceId: qaRecord._id,
      summary: `Marked AI answer as ${rating === "up" ? "helpful" : "needs review"}`,
    });

    res.status(200).json({
      message: "Feedback saved.",
      feedback,
    });
  } catch (error) {
    console.error("Save feedback error:", error);
    res.status(500).json({ message: "Failed to save feedback." });
  }
});

router.get("/stats", protect, async (req, res) => {
  try {
    const rows = await FeedbackModel.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]);

    let up = 0;
    let down = 0;
    rows.forEach((row) => {
      if (row._id === "up") up = row.count;
      if (row._id === "down") down = row.count;
    });
    const total = up + down;

    res.json({
      total,
      up,
      down,
      helpfulnessRate: total > 0 ? Math.round((up / total) * 100) : null,
    });
  } catch (error) {
    console.error("Feedback stats error:", error);
    res.status(500).json({ message: "Failed to fetch feedback stats." });
  }
});

module.exports = router;
