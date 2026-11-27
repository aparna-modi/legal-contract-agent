const fs = require("fs");
const path = require("path");

const FAILURE_THRESHOLD = Number(process.env.AI_CIRCUIT_THRESHOLD || 3);
const COOLDOWN_MS = Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 20000);
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || (process.env.NODE_ENV === "production" ? 155000 : 90000));
const HEALTH_TIMEOUT_MS = Number(process.env.AI_HEALTH_TIMEOUT_MS || 15000);
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

function isGatewayErrorStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

async function extractAiErrorMessage(aiRes, fallbackMessage) {
  const status = aiRes?.status || 502;
  const contentType = aiRes?.headers?.get?.("content-type") || "";
  let detail = "";
  let rawSnippet = "";

  try {
    if (contentType.includes("application/json")) {
      const parsed = await aiRes.json().catch(() => null);
      detail = String(parsed?.detail || parsed?.message || "").trim();
    } else {
      const txt = await aiRes.text().catch(() => "");
      rawSnippet = txt.replace(/\s+/g, " ").trim().slice(0, 180);
      if (rawSnippet.startsWith("{")) {
        try {
          const parsed = JSON.parse(txt);
          detail = String(parsed?.detail || parsed?.message || "").trim();
        } catch {
          // Non-JSON body (e.g., Render gateway HTML)
        }
      }
    }
  } catch {
    // Ignore body read error
  }

  console.warn(
    `[aiClient] Upstream AI error HTTP ${status}: ${detail || rawSnippet || fallbackMessage}`
  );

  if (detail) return detail;
  if (isGatewayErrorStatus(status)) {
    return "AI engine is waking up or temporarily busy. Please try again in a few seconds.";
  }
  return fallbackMessage;
}

class AiServicePool {
  constructor() {
    this._nodes = [];
    this._cursor = 0;
    this._spec = "";
    this._wakeupPromises = new Map();
    this._bgWarmPromises = new Map();
    this._keepAliveTimer = null;
    this._syncNodes();
  }

  _getWakeupTimeoutMs() {
    if (process.env.AI_WAKEUP_TIMEOUT_MS !== undefined) {
      return Math.max(0, Number(process.env.AI_WAKEUP_TIMEOUT_MS) || 0);
    }
    return process.env.NODE_ENV === "production" ? 75000 : 0;
  }

  _getWakeupPollMs() {
    if (process.env.AI_WAKEUP_POLL_MS !== undefined) {
      return Math.max(50, Number(process.env.AI_WAKEUP_POLL_MS) || 150);
    }
    return process.env.NODE_ENV === "production" ? 2500 : 120;
  }

  _syncNodes() {
    const raw = (process.env.AI_SERVICE_URLS || process.env.AI_SERVICE_URL || "http://127.0.0.1:8000").trim();
    if (raw === this._spec && this._nodes.length) return;
    this._spec = raw;
    const prev = new Map(this._nodes.map((n) => [n.url, n]));
    this._nodes = raw
      .split(",")
      .map((u) => u.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .map((u) => (/^https?:\/\//i.test(u) ? u : `http://${u}`))
      .map(
        (url) =>
          prev.get(url) || {
            url,
            state: "CLOSED",
            failures: 0,
            openedAt: 0,
            totalRequests: 0,
            totalErrors: 0,
            avgLatencyMs: 0,
            lastError: null,
            lastCheckedAt: null,
            lastHealthyAt: 0,
          }
      );
    if (this._cursor >= this._nodes.length) this._cursor = 0;
  }

  _pickCandidates() {
    this._syncNodes();
    const now = Date.now();
    const total = this._nodes.length;
    const ordered = [];
    for (let i = 0; i < total; i++) {
      const n = this._nodes[(this._cursor + i) % total];
      if (n.state === "OPEN" && now - n.openedAt >= COOLDOWN_MS) n.state = "HALF_OPEN";
      ordered.push(n);
    }
    this._cursor = (this._cursor + 1) % Math.max(1, total);
    const openReady = ordered.filter((n) => n.state !== "OPEN");
    return openReady.length ? openReady : [...ordered].sort((a, b) => a.openedAt - b.openedAt).slice(0, 1);
  }

  _markSuccess(node, latencyMs) {
    node.state = "CLOSED";
    node.failures = 0;
    node.openedAt = 0;
    node.lastError = null;
    node.lastHealthyAt = Date.now();
    node.lastCheckedAt = new Date().toISOString();
    node.avgLatencyMs = node.avgLatencyMs
      ? Math.round(node.avgLatencyMs * 0.7 + latencyMs * 0.3)
      : Math.round(latencyMs);
  }

  _markFailure(node, msg) {
    node.failures += 1;
    node.totalErrors += 1;
    node.lastError = msg;
    node.lastCheckedAt = new Date().toISOString();
    if (node.failures >= FAILURE_THRESHOLD || node.state === "HALF_OPEN") {
      node.state = "OPEN";
      node.openedAt = Date.now();
    }
  }

  _headers(extra = {}, requestId = "") {
    const h = { ...extra };
    const key = (process.env.INTERNAL_API_KEY || "").trim();
    if (key) h["X-Internal-Service-Key"] = key;
    if (requestId) h["X-Request-Id"] = requestId;
    return h;
  }

  /**
   * Coalesced cold-start wakeup loop: multiple concurrent user requests targeting
   * a waking Render container share one /health/ready poller instead of stampeding it.
   */
  async _waitForNodeReady(node, maxWaitMs) {
    if (maxWaitMs <= 0) return false;
    const existing = this._wakeupPromises.get(node.url);
    if (existing) return existing;

    const pollMs = this._getWakeupPollMs();
    const promise = (async () => {
      const deadline = Date.now() + maxWaitMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const started = Date.now();
        try {
          const probeRes = await fetch(`${node.url}/health/ready`, {
            signal: AbortSignal.timeout(Math.min(12000, Math.max(500, remaining))),
          });
          if (probeRes.ok) {
            this._markSuccess(node, Date.now() - started);
            return true;
          }
        } catch {
          // Keep polling while container starts up
        }
        const sleepMs = Math.min(pollMs, Math.max(0, deadline - Date.now()));
        if (sleepMs > 0) {
          await new Promise((r) => setTimeout(r, sleepMs));
        }
      }
      return false;
    })().finally(() => {
      this._wakeupPromises.delete(node.url);
    });

    this._wakeupPromises.set(node.url, promise);
    return promise;
  }

  async request(
    endpoint,
    {
      method = "GET",
      body,
      bodyFactory,
      headers = {},
      timeoutMs = DEFAULT_TIMEOUT_MS,
      requestId = "",
      waitForWakeup = true,
    } = {}
  ) {
    const candidates = this._pickCandidates();
    const wakeupTimeoutMs = waitForWakeup ? this._getWakeupTimeoutMs() : 0;
    const attempts = Math.max(1, Math.min(candidates.length + MAX_RETRIES, 4));
    const retryBaseMs = process.env.NODE_ENV === "production" ? 1200 : 180;
    const waitedNodes = new Set();
    let lastErr = null;
    let lastGatewayRes = null;

    for (let i = 0; i < attempts; i++) {
      const node = candidates[i % candidates.length];
      node.totalRequests += 1;
      const started = Date.now();
      try {
        const finalHeaders = this._headers(headers, requestId);
        let finalBody = typeof bodyFactory === "function" ? bodyFactory() : body;
        if (finalBody && !(finalBody instanceof FormData) && typeof finalBody !== "string" && !Buffer.isBuffer(finalBody)) {
          finalHeaders["Content-Type"] = "application/json";
          finalBody = JSON.stringify(finalBody);
        }
        const res = await fetch(`${node.url}${endpoint}`, {
          method,
          headers: finalHeaders,
          body: finalBody,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (isGatewayErrorStatus(res.status)) {
          // If this is a FastAPI JSON 503 for misconfiguration (not a Render cold-start gateway page),
          // avoid burning a full wakeup cycle on a permanent config error.
          const ct = res.headers.get("content-type") || "";
          const isConfigFailure = res.status === 503 && ct.includes("application/json");
          if (isConfigFailure) {
            const cloned = res.clone();
            const parsed = await cloned.json().catch(() => null);
            if (parsed?.detail && /not configured/i.test(String(parsed.detail))) {
              this._markFailure(node, `HTTP 503 (${parsed.detail})`);
              return res;
            }
          }

          lastGatewayRes = res;
          lastErr = new Error(`AI worker returned HTTP ${res.status}`);

          // If another healthy node is available in a multi-node pool, fail over immediately first.
          if (candidates.length > 1 && i < candidates.length - 1) {
            this._markFailure(node, `HTTP ${res.status}`);
            continue;
          }

          // Single-node or all nodes cold-starting: wait cleanly for /health/ready before retrying.
          if (wakeupTimeoutMs > 0 && !waitedNodes.has(node.url)) {
            waitedNodes.add(node.url);
            console.info(
              `[aiClient] ${node.url} returned HTTP ${res.status} on ${endpoint}; waiting up to ${Math.round(wakeupTimeoutMs / 1000)}s for AI worker wakeup...`
            );
            const woke = await this._waitForNodeReady(node, wakeupTimeoutMs);
            if (woke) {
              // Retry immediately now that the worker is confirmed ready
              i -= 1;
              continue;
            }
          }

          this._markFailure(node, `HTTP ${res.status}`);
          if (i < attempts - 1) {
            await new Promise((r) => setTimeout(r, retryBaseMs * 2 ** i));
            continue;
          }
          if (wakeupTimeoutMs > 0) {
            break;
          }
          return res;
        }

        this._markSuccess(node, Date.now() - started);
        return res;
      } catch (err) {
        const errMsg = err?.name === "TimeoutError" ? "Request timed out" : err?.message || "Network error";
        lastErr = err;

        if (candidates.length > 1 && i < candidates.length - 1) {
          this._markFailure(node, errMsg);
          continue;
        }

        if (wakeupTimeoutMs > 0 && !waitedNodes.has(node.url)) {
          waitedNodes.add(node.url);
          console.info(
            `[aiClient] ${node.url} unreachable (${errMsg}) on ${endpoint}; waiting up to ${Math.round(wakeupTimeoutMs / 1000)}s for AI worker wakeup...`
          );
          const woke = await this._waitForNodeReady(node, wakeupTimeoutMs);
          if (woke) {
            i -= 1;
            continue;
          }
        }

        this._markFailure(node, errMsg);
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, retryBaseMs * 2 ** i));
        }
      }
    }

    if (lastGatewayRes && wakeupTimeoutMs === 0) {
      return lastGatewayRes;
    }

    const err = new Error("AI engine is waking up from idle. Please retry in a few seconds.");
    err.status = 503;
    err.code = "AI_WORKER_UNAVAILABLE";
    err.cause = lastErr;
    throw err;
  }

  async extractContractFile({ buffer, filePath, fileName, title, userId, documentId, requestId = "" }) {
    const fileBuf = buffer || (await fs.promises.readFile(filePath));
    const ext = path.extname(fileName || filePath || "").toLowerCase();
    const resolvedName = fileName || path.basename(filePath || "contract.txt");
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";

    const buildForm = () => {
      const form = new FormData();
      form.append("file", new Blob([fileBuf], { type: mime }), resolvedName);
      if (title) form.append("title", title);
      form.append("embed", "true");
      form.append("user_id", String(userId));
      form.append("document_id", String(documentId));
      form.append("index_vector", "true");
      return form;
    };

    return this.request("/api/v1/extract", {
      method: "POST",
      bodyFactory: buildForm,
      timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 120000),
      requestId,
    });
  }

  /**
   * Fire-and-forget throttled warmup so browsing the workspace wakes the AI container
   * before the user clicks Draft, Ask Contract, Compare, or Playbook Audit.
   */
  ensureWarmBackground({ minIntervalMs = 120000 } = {}) {
    this._syncNodes();
    const now = Date.now();
    for (const node of this._nodes) {
      if (node.lastHealthyAt && now - node.lastHealthyAt < minIntervalMs) continue;
      if (this._bgWarmPromises.has(node.url) || this._wakeupPromises.has(node.url)) continue;

      const p = (async () => {
        const started = Date.now();
        try {
          const res = await fetch(`${node.url}/health/ready`, {
            signal: AbortSignal.timeout(35000),
          });
          if (res.ok) {
            this._markSuccess(node, Date.now() - started);
          }
        } catch {
          // Best-effort warmup; never throw into caller paths
        }
      })().finally(() => {
        this._bgWarmPromises.delete(node.url);
      });

      this._bgWarmPromises.set(node.url, p);
    }
  }

  /**
   * Periodic production keep-alive heartbeat that keeps the AI service, MongoDB pool,
   * backend external URL, and frontend SPA warm so zero services ever go idle or sleep.
   */
  startKeepAlive({ onPulse } = {}) {
    const enabled =
      process.env.ENABLE_KEEP_ALIVE === "true" ||
      (process.env.NODE_ENV === "production" && process.env.ENABLE_KEEP_ALIVE !== "false");
    if (!enabled || this._keepAliveTimer) return;

    const intervalMs = Math.max(60000, Number(process.env.KEEP_ALIVE_INTERVAL_MS || 240000));

    const pingAll = async () => {
      this._syncNodes();
      for (const node of this._nodes) {
        const started = Date.now();
        try {
          const res = await fetch(`${node.url}/health/ready`, {
            signal: AbortSignal.timeout(45000),
          });
          if (res.ok) {
            this._markSuccess(node, Date.now() - started);
          }
        } catch {
          // Next cycle will retry
        }
      }

      if (typeof onPulse === "function") {
        await onPulse().catch(() => {});
      }

      const selfUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BACKEND_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
      if (selfUrl) {
        await fetch(`${selfUrl}/health/live`, { signal: AbortSignal.timeout(15000) }).catch(() => {});
      }

      const frontendUrl = (process.env.FRONTEND_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
      if (frontendUrl) {
        await fetch(frontendUrl, { signal: AbortSignal.timeout(15000) }).catch(() => {});
      }
    };

    // Kick off an immediate non-blocking warmup on server start.
    setTimeout(() => {
      pingAll().catch(() => {});
    }, 1500).unref();

    this._keepAliveTimer = setInterval(() => {
      pingAll().catch(() => {});
    }, intervalMs);
    this._keepAliveTimer.unref();
    console.info(`[aiClient] Background keep-alive enabled (interval=${Math.round(intervalMs / 1000)}s).`);
  }

  stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  async probeHealth({ timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
    this._syncNodes();
    return Promise.all(
      this._nodes.map(async (n) => {
        const started = Date.now();
        try {
          const res = await fetch(`${n.url}/health/ready`, { signal: AbortSignal.timeout(timeoutMs) });
          const latencyMs = Date.now() - started;
          if (!res.ok) {
            const waking = isGatewayErrorStatus(res.status);
            return {
              url: n.url,
              reachable: false,
              status: waking ? "waking" : "unreachable",
              circuitState: n.state,
              httpStatus: res.status,
              latencyMs,
              error: waking ? `Service waking up (HTTP ${res.status})` : `HTTP ${res.status}`,
            };
          }
          const body = await res.json().catch(() => ({}));
          this._markSuccess(n, latencyMs);
          return {
            url: n.url,
            reachable: true,
            status: "healthy",
            circuitState: n.state,
            latencyMs,
            avgLatencyMs: n.avgLatencyMs,
            totalRequests: n.totalRequests,
            totalErrors: n.totalErrors,
            llmProvider: body.llm_provider || "unknown",
            embeddingProvider: body.embedding_provider || "unknown",
          };
        } catch (err) {
          const isTimeout = err?.name === "TimeoutError" || /timeout|aborted/i.test(err?.message || "");
          return {
            url: n.url,
            reachable: false,
            status: isTimeout ? "waking" : "unreachable",
            circuitState: n.state,
            error: isTimeout ? "Worker is starting up (cold start)" : err?.message || "Unreachable",
          };
        }
      })
    );
  }

  getPoolStatus() {
    this._syncNodes();
    return {
      strategy: "round-robin-circuit-breaker",
      totalNodes: this._nodes.length,
      healthyNodes: this._nodes.filter((n) => n.state !== "OPEN").length,
      nodes: this._nodes.map((n) => ({
        url: n.url,
        circuitState: n.state,
        failures: n.failures,
        totalRequests: n.totalRequests,
        totalErrors: n.totalErrors,
        avgLatencyMs: n.avgLatencyMs,
        lastCheckedAt: n.lastCheckedAt,
      })),
    };
  }
}

module.exports = { aiClient: new AiServicePool(), extractAiErrorMessage };
