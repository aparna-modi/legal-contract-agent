const mongoose = require("mongoose");
const crypto = require("crypto");

const memberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "counsel", "reviewer"],
      default: "reviewer",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    members: {
      type: [memberSchema],
      default: [],
    },
    inviteCode: {
      type: String,
      default: () => crypto.randomBytes(6).toString("hex"),
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

organizationSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Organization", organizationSchema);
