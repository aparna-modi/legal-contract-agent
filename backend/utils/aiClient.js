const fs = require("fs");
const path = require("path");

const FAILURE_THRESHOLD = Number(process.env.AI_CIRCUIT_THRESHOLD || 3);
const COOLDOWN_MS = Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 20000);
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

class AiServicePool {
  constructor() {
    this._nodes = [];
    this._cursor = 0;
    this._spec = "";
    this._syncNodes();
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

  async request(endpoint, { method = "GET", body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, requestId = "" } = {}) {
    const candidates = this._pickCandidates();
    const attempts = Math.max(1, Math.min(candidates.length + MAX_RETRIES, 4));
    const retryBaseMs = process.env.NODE_ENV === "production" ? 900 : 180;
    let lastErr = null;

    for (let i = 0; i < attempts; i++) {
      const node = candidates[i % candidates.length];
      node.totalRequests += 1;
      const started = Date.now();
      try {
        const finalHeaders = this._headers(headers, requestId);
        let finalBody = body;
        if (body && !(body instanceof FormData) && typeof body !== "string" && !Buffer.isBuffer(body)) {
          finalHeaders["Content-Type"] = "application/json";
          finalBody = JSON.stringify(body);
        }
        const res = await fetch(`${node.url}${endpoint}`, {
          method,
          headers: finalHeaders,
          body: finalBody,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if ([502, 503, 504].includes(res.status)) {
          this._markFailure(node, `HTTP ${res.status}`);
          lastErr = new Error(`AI worker returned HTTP ${res.status}`);
          if (i < attempts - 1) {
            await new Promise((r) => setTimeout(r, retryBaseMs * 2 ** i));
            continue;
          }
          return res;
        }
        this._markSuccess(node, Date.now() - started);
        return res;
      } catch (err) {
        this._markFailure(node, err?.name === "TimeoutError" ? "Request timed out" : err?.message || "Network error");
        lastErr = err;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, retryBaseMs * 2 ** i));
      }
    }

    const err = new Error("AI service is temporarily unavailable. Please retry in a few seconds while the worker warms up.");
    err.status = 503;
    err.cause = lastErr;
    throw err;
  }

  async extractContractFile({ buffer, filePath, fileName, title, userId, documentId, requestId = "" }) {
    const fileBuf = buffer || (await fs.promises.readFile(filePath));
    const ext = path.extname(fileName || filePath || "").toLowerCase();
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileBuf], { type: MIME_BY_EXT[ext] || "application/octet-stream" }),
      fileName || path.basename(filePath || "contract.txt")
    );
    if (title) form.append("title", title);
    form.append("embed", "true");
    form.append("user_id", String(userId));
    form.append("document_id", String(documentId));
    form.append("index_vector", "true");

    return this.request("/api/v1/extract", {
      method: "POST",
      body: form,
      timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, 120000),
      requestId,
    });
  }

  async probeHealth() {
    this._syncNodes();
    return Promise.all(
      this._nodes.map(async (n) => {
        const started = Date.now();
        try {
          const res = await fetch(`${n.url}/health/ready`, { signal: AbortSignal.timeout(4000) });
          const latencyMs = Date.now() - started;
          if (!res.ok) return { url: n.url, reachable: false, circuitState: n.state, httpStatus: res.status, latencyMs };
          const body = await res.json().catch(() => ({}));
          return {
            url: n.url,
            reachable: true,
            circuitState: n.state,
            latencyMs,
            avgLatencyMs: n.avgLatencyMs,
            totalRequests: n.totalRequests,
            totalErrors: n.totalErrors,
            llmProvider: body.llm_provider || "unknown",
            embeddingProvider: body.embedding_provider || "unknown",
          };
        } catch (err) {
          return { url: n.url, reachable: false, circuitState: n.state, error: err?.message || "Unreachable" };
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

module.exports = { aiClient: new AiServicePool() };
