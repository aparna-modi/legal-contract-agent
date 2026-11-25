const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: ["reviewer", "counsel", "admin"],
      default: "reviewer",
    },

    organization: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "Personal Workspace",
    },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    tokenVersion: {
      type: Number,
      default: 0,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

userSchema.methods.toSafeProfile = function toSafeProfile() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role || "reviewer",
    organization: this.organization || "Personal Workspace",
    organizationId: this.organizationId || null,
    emailVerified: Boolean(this.emailVerified),
    lastLoginAt: this.lastLoginAt || null,
    createdAt: this.createdAt || null,
  };
};

module.exports = mongoose.model("User", userSchema);
