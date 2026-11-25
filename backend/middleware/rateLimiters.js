const rateLimitPkg = require("express-rate-limit");
const { HybridRateLimitStore } = require("../utils/redisStore");

const rateLimit = rateLimitPkg.rateLimit || rateLimitPkg;
const ipKeyGenerator = rateLimitPkg.ipKeyGenerator;

function userOrIpKey(req) {
  if (req.user && req.user._id) {
    return `user:${req.user._id.toString()}`;
  }
  if (typeof ipKeyGenerator === "function") {
    return ipKeyGenerator(req.ip || "127.0.0.1");
  }
  return req.ip || "127.0.0.1";
}

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GENERAL_RATE_LIMIT_MAX || 400),
  store: new HybridRateLimitStore("general"),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/health") || req.path === "/metrics",
  message: {
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests from this client. Please slow down and try again shortly.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 40),
  store: new HybridRateLimitStore("auth"),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "AUTH_RATE_LIMIT_EXCEEDED",
    message: "Too many authentication attempts. Please wait a few minutes and try again.",
  },
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 100),
  keyGenerator: userOrIpKey,
  store: new HybridRateLimitStore("ai"),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "AI_RATE_LIMIT_EXCEEDED",
    message: "AI request quota reached for this window. Please wait a moment before sending more queries.",
  },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 50),
  keyGenerator: userOrIpKey,
  store: new HybridRateLimitStore("upload"),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "UPLOAD_RATE_LIMIT_EXCEEDED",
    message: "Upload rate limit reached. Please wait a few minutes before uploading more files.",
  },
});

module.exports = { generalLimiter, authLimiter, aiLimiter, uploadLimiter };
