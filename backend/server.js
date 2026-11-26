const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

const connectDB = require("./config/db");
const { generalLimiter, authLimiter } = require("./middleware/rateLimiters");
const { requestContext, sanitizeRequest } = require("./middleware/securityMiddleware");
const { aiClient } = require("./utils/aiClient");
const { closeRedis, initRedis } = require("./utils/redisStore");
const { captureError, renderPrometheusMetrics } = require("./utils/metrics");
const authRoutes = require("./routes/authRoutes");
const contractRoutes = require("./routes/contractRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const systemRoutes = require("./routes/systemRoutes");
const teamRoutes = require("./routes/teamRoutes");
const playbookRoutes = require("./routes/playbookRoutes");

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(requestContext);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  })
);

const defaultDevOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://localhost:80",
  "http://localhost",
];
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length > 0 ? configuredOrigins : defaultDevOrigins);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin) || allowedOrigins.has("*")) {
        return callback(null, true);
      }
      if (!isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not permitted by CORS policy."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(sanitizeRequest);
app.use(generalLimiter);

app.get("/", (req, res) => {
  res.json({
    status: "Legal Contract Agent API is running",
    version: "2.1.0",
    endpoints: {
      auth: "/api/auth",
      contracts: "/api/contracts",
      playbook: "/api/playbook",
      team: "/api/team",
      feedback: "/api/feedback",
      analytics: "/api/analytics",
      system: "/api/system/status",
      metrics: "/metrics",
      health: "/health",
      live: "/health/live",
      ready: "/health/ready",
    },
  });
});

const healthHandler = (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const pool = aiClient.getPoolStatus();
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "healthy" : "degraded",
    service: "Legal Contract Agent API",
    version: "2.1.0",
    uptimeSeconds: Math.round(process.uptime()),
    database: dbConnected ? "connected" : "disconnected",
    aiPool: {
      totalNodes: pool.totalNodes,
      healthyNodes: pool.healthyNodes,
    },
  });
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

app.get("/health/live", (req, res) => {
  res.json({ status: "alive", uptimeSeconds: Math.round(process.uptime()) });
});

app.get("/health/ready", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  if (!dbConnected) {
    return res.status(503).json({ status: "not_ready", database: "disconnected" });
  }
  const pool = aiClient.getPoolStatus();
  res.json({
    status: "ready",
    database: "connected",
    aiPool: {
      totalNodes: pool.totalNodes,
      healthyNodes: pool.healthyNodes,
      strategy: pool.strategy,
    },
  });
});

app.get("/metrics", (req, res) => {
  const expectedKey = (process.env.INTERNAL_API_KEY || "").trim();
  const providedKey = String(req.headers["x-internal-service-key"] || "").trim();
  if (isProd) {
    if (!expectedKey || providedKey.length !== expectedKey.length || !crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey))) {
      return res.status(401).json({ message: "Unauthorized metrics scrape." });
    }
  } else if (expectedKey && providedKey !== expectedKey) {
    return res.status(401).json({ message: "Unauthorized metrics scrape." });
  }
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/contracts", contractRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/playbook", playbookRoutes);

app.use((req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON payload." });
  }
  if (err && err.message === "Origin not permitted by CORS policy.") {
    return res.status(403).json({ message: err.message });
  }
  captureError(err, { requestId: req.requestId, path: req.originalUrl, method: req.method });
  console.error(`[${req.requestId || "no-id"}] Unhandled API error:`, err?.message || err);
  res.status(err?.status || 500).json({
    message: isProd ? "Internal server error." : err?.message || "Internal server error",
    requestId: req.requestId,
  });
});

const PORT = process.env.PORT || 5000;
let httpServer = null;
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Draining HTTP connections and closing stores...`);

  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing exit.");
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  aiClient.stopKeepAlive();
  await closeRedis().catch(() => {});
  try {
    await mongoose.connection.close(false);
  } catch {
    // Ignore close error
  }
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const startServer = async () => {
  try {
    if (!process.env.JWT_SECRET || (isProd && process.env.JWT_SECRET.length < 32)) {
      throw new Error(
        "JWT_SECRET must be set (and at least 32 characters in production) before starting."
      );
    }
    initRedis();
    await connectDB();
    httpServer = app.listen(PORT, () => {
      console.log(`API server listening on http://localhost:${PORT}`);
      aiClient.startKeepAlive();
    });
    httpServer.keepAliveTimeout = 65000;
    httpServer.headersTimeout = 66000;
    httpServer.requestTimeout = 150000;
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
