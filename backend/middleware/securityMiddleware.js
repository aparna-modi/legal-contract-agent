const crypto = require("crypto");
const { sanitizeValue } = require("../utils/security");
const { recordHttpMetric } = require("../utils/metrics");

function requestContext(req, res, next) {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.trim().length > 0 && incomingId.length <= 128
      ? incomingId.trim()
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    recordHttpMetric(req.method, req.originalUrl || req.url, res.statusCode, durationMs);
    if (req.path === "/health/live" && res.statusCode < 400) return;

    if (process.env.NODE_ENV === "production") {
      console.log(
        JSON.stringify({
          level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
          ts: new Date().toISOString(),
          requestId,
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          durationMs,
          userId: req.user?._id?.toString() || null,
        })
      );
    }
  });

  next();
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  if (req.params && typeof req.params === "object") {
    for (const key of Object.keys(req.params)) {
      if (typeof req.params[key] === "string") {
        req.params[key] = req.params[key].replace(/\0/g, "");
      }
    }
  }
  if (req.query && typeof req.query === "object") {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith("$") || key === "__proto__" || key === "constructor" || key === "prototype") {
        delete req.query[key];
      } else {
        req.query[key] = sanitizeValue(req.query[key]);
      }
    }
  }
  next();
}

module.exports = { requestContext, sanitizeRequest };
