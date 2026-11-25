const mongoose = require("mongoose");
const { aiClient } = require("./aiClient");
const { extractionQueue } = require("./jobQueue");
const { getRedisStatus } = require("./redisStore");

/**
 * Lightweight Prometheus metrics collector + optional Sentry error reporter.
 */

const requestCounters = new Map();
let totalDurationMs = 0;
let totalRequests = 0;
let errorCount5xx = 0;

function normalizePath(rawPath = "/") {
  return String(rawPath)
    .split("?")[0]
    .replace(/[0-9a-f]{24}/gi, ":id")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid");
}

function recordHttpMetric(method, rawPath, statusCode, durationMs) {
  const path = normalizePath(rawPath);
  const key = `${method}|${path}|${statusCode}`;
  requestCounters.set(key, (requestCounters.get(key) || 0) + 1);
  totalDurationMs += durationMs;
  totalRequests += 1;
  if (statusCode >= 500) errorCount5xx += 1;
}

function captureError(err, context = {}) {
  const dsn = (process.env.SENTRY_DSN || "").trim();
  if (dsn) {
    // Structured error envelope ready for Sentry/log-shipper ingestion
    console.error(
      JSON.stringify({
        telemetry: "sentry_envelope",
        error: err?.message || String(err),
        stack: err?.stack?.slice(0, 800),
        ...context,
      })
    );
  }
}

function renderPrometheusMetrics() {
  const pool = aiClient.getPoolStatus();
  const queue = extractionQueue.getQueueStats();
  const redis = getRedisStatus();
  const mem = process.memoryUsage();
  const avgMs = totalRequests > 0 ? (totalDurationMs / totalRequests).toFixed(2) : "0";

  const lines = [
    "# HELP lca_http_requests_total Total HTTP requests processed by the API gateway",
    "# TYPE lca_http_requests_total counter",
  ];

  for (const [key, count] of requestCounters.entries()) {
    const [method, path, status] = key.split("|");
    lines.push(`lca_http_requests_total{method="${method}",route="${path}",status="${status}"} ${count}`);
  }

  lines.push(
    "# HELP lca_http_request_duration_ms_avg Average API request latency in milliseconds",
    "# TYPE lca_http_request_duration_ms_avg gauge",
    `lca_http_request_duration_ms_avg ${avgMs}`,
    "# HELP lca_http_errors_5xx_total Total 5xx server errors",
    "# TYPE lca_http_errors_5xx_total counter",
    `lca_http_errors_5xx_total ${errorCount5xx}`,
    "# HELP lca_process_uptime_seconds Process uptime in seconds",
    "# TYPE lca_process_uptime_seconds gauge",
    `lca_process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP lca_process_resident_memory_bytes Process RSS memory in bytes",
    "# TYPE lca_process_resident_memory_bytes gauge",
    `lca_process_resident_memory_bytes ${mem.rss}`,
    "# HELP lca_db_connected MongoDB connection status (1=connected, 0=disconnected)",
    "# TYPE lca_db_connected gauge",
    `lca_db_connected ${mongoose.connection.readyState === 1 ? 1 : 0}`,
    "# HELP lca_redis_connected Redis connection status (1=connected, 0=fallback)",
    "# TYPE lca_redis_connected gauge",
    `lca_redis_connected ${redis.connected ? 1 : 0}`,
    "# HELP lca_ai_pool_healthy_nodes Number of non-open AI worker nodes",
    "# TYPE lca_ai_pool_healthy_nodes gauge",
    `lca_ai_pool_healthy_nodes ${pool.healthyNodes}`,
    "# HELP lca_extraction_jobs_active Active background extraction jobs",
    "# TYPE lca_extraction_jobs_active gauge",
    `lca_extraction_jobs_active ${queue.active}`,
    "# HELP lca_extraction_jobs_queued Pending background extraction jobs",
    "# TYPE lca_extraction_jobs_queued gauge",
    `lca_extraction_jobs_queued ${queue.queued}`
  );

  return `${lines.join("\n")}\n`;
}

module.exports = { recordHttpMetric, captureError, renderPrometheusMetrics };
