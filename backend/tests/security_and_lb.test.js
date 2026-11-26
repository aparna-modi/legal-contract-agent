const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.JWT_SECRET = "test-super-secure-jwt-secret-key-at-least-32-chars-long";

const {
  isValidEmail,
  validatePasswordStrength,
  sanitizeValue,
  validateFileMagicBytes,
  parseDeviceLabel,
} = require("../utils/security");
const {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  parseCookies,
} = require("../utils/tokens");
const { aiClient, extractAiErrorMessage } = require("../utils/aiClient");
const { storageService } = require("../utils/storage");
const { extractionQueue } = require("../utils/jobQueue");
const { renderPrometheusMetrics } = require("../utils/metrics");

test("Email & password validation enforces production rules", () => {
  assert.equal(isValidEmail("counsel@acme.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);

  assert.ok(validatePasswordStrength("short1"));
  assert.ok(validatePasswordStrength("onlyletters"));
  assert.ok(validatePasswordStrength("12345678"));
  assert.equal(validatePasswordStrength("SecurePass123"), null);
});

test("sanitizeValue strips NoSQL operators, prototype pollution keys, and null bytes", () => {
  const malicious = {
    email: { $ne: null },
    name: "Alice\0Admin",
    nested: {
      $where: "1==1",
      constructor: { prototype: { isAdmin: true } },
      safe: "ok",
    },
  };
  const cleaned = sanitizeValue(malicious);
  assert.deepEqual(cleaned.email, {});
  assert.equal(cleaned.name, "AliceAdmin");
  assert.equal(cleaned.nested.$where, undefined);
  assert.equal(cleaned.nested.safe, "ok");
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned.nested, "constructor"), false);
});

test("JWT access tokens encode role and tokenVersion and reject tampering", () => {
  const user = { _id: "65f1a2b3c4d5e6f7a8b9c0d1", role: "counsel", tokenVersion: 3 };
  const token = signAccessToken(user);
  const decoded = verifyAccessToken(token);

  assert.equal(decoded.userId, user._id);
  assert.equal(decoded.role, "counsel");
  assert.equal(decoded.tv, 3);
  assert.equal(decoded.iss, "legal-contract-agent");
  assert.ok(decoded.jti);

  assert.throws(() => verifyAccessToken(token + "tampered"));

  const r1 = generateRefreshToken();
  const r2 = generateRefreshToken();
  assert.notEqual(r1, r2);
  assert.equal(hashToken(r1).length, 64);

  const parsed = parseCookies({ headers: { cookie: "a=1; lca_refresh_token=abc%2B123" } });
  assert.equal(parsed.lca_refresh_token, "abc+123");
});

test("Magic-byte validation accepts real signatures and rejects disguised files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lca-sec-"));
  try {
    const validPdf = path.join(tmpDir, "ok.pdf");
    fs.writeFileSync(validPdf, Buffer.from("%PDF-1.7\n1 0 obj\n"));
    assert.equal(validateFileMagicBytes(validPdf, "pdf").valid, true);

    const fakePdf = path.join(tmpDir, "fake.pdf");
    fs.writeFileSync(fakePdf, Buffer.from("<html><script>alert(1)</script></html>"));
    assert.equal(validateFileMagicBytes(fakePdf, "pdf").valid, false);

    const validDocx = path.join(tmpDir, "ok.docx");
    fs.writeFileSync(validDocx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    assert.equal(validateFileMagicBytes(validDocx, "docx").valid, true);

    const binaryTxt = path.join(tmpDir, "bin.txt");
    fs.writeFileSync(binaryTxt, Buffer.from([0x41, 0x42, 0x00, 0x43]));
    assert.equal(validateFileMagicBytes(binaryTxt, "txt").valid, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("parseDeviceLabel extracts clean browser/OS labels", () => {
  assert.equal(
    parseDeviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36"),
    "Chrome on Windows"
  );
  assert.equal(parseDeviceLabel(""), "API Client");
});

test("AiServicePool load-balances round-robin and fails over when one node returns 503", async () => {
  const hits = { node1: 0, node2: 0 };
  let failNode1 = false;

  const srv1 = http.createServer((req, res) => {
    hits.node1 += 1;
    if (failNode1) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "overloaded" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ worker: "node1", reqId: req.headers["x-request-id"] || "" }));
  });

  const srv2 = http.createServer((req, res) => {
    hits.node2 += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ worker: "node2", reqId: req.headers["x-request-id"] || "" }));
  });

  await Promise.all([
    new Promise((resolve) => srv1.listen(0, "127.0.0.1", resolve)),
    new Promise((resolve) => srv2.listen(0, "127.0.0.1", resolve)),
  ]);

  const prevUrls = process.env.AI_SERVICE_URLS;
  const url1 = `http://127.0.0.1:${srv1.address().port}`;
  const url2 = `http://127.0.0.1:${srv2.address().port}`;
  process.env.AI_SERVICE_URLS = `${url1},${url2}`;

  try {
    // Two healthy calls should round-robin across both workers.
    const r1 = await (await aiClient.request("/ping", { requestId: "trace-1" })).json();
    const r2 = await (await aiClient.request("/ping", { requestId: "trace-2" })).json();
    assert.notEqual(r1.worker, r2.worker);
    assert.equal(r1.reqId, "trace-1");

    // Simulate node1 failure: request must transparently fail over to node2.
    failNode1 = true;
    const r3 = await (await aiClient.request("/ping", { requestId: "trace-3" })).json();
    assert.equal(r3.worker, "node2");
  } finally {
    if (prevUrls === undefined) delete process.env.AI_SERVICE_URLS;
    else process.env.AI_SERVICE_URLS = prevUrls;
    srv1.close();
    srv2.close();
  }
});

test("S3StorageAdapter signs SigV4 requests and handles PUT/GET/DELETE", async () => {
  const objects = new Map();
  let sawAuthHeader = false;

  const mockS3 = http.createServer((req, res) => {
    if ((req.headers.authorization || "").startsWith("AWS4-HMAC-SHA256")) {
      sawAuthHeader = true;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.method === "PUT") {
        objects.set(req.url, body);
        res.writeHead(200);
        res.end();
      } else if (req.method === "GET") {
        const found = objects.get(req.url);
        if (!found) {
          res.writeHead(404);
          res.end();
        } else {
          res.writeHead(200);
          res.end(found);
        }
      } else if (req.method === "DELETE") {
        objects.delete(req.url);
        res.writeHead(204);
        res.end();
      }
    });
  });

  await new Promise((resolve) => mockS3.listen(0, "127.0.0.1", resolve));
  const prevEnv = {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };

  process.env.S3_BUCKET = "test-contracts";
  process.env.S3_ENDPOINT = `http://127.0.0.1:${mockS3.address().port}`;
  process.env.S3_ACCESS_KEY_ID = "AKIA_TEST";
  process.env.S3_SECRET_ACCESS_KEY = "SECRET_TEST_KEY";

  try {
    const adapter = new storageService.S3StorageAdapter();
    await adapter.putObject({
      key: "user1/sample.txt",
      buffer: Buffer.from("Confidential MSA"),
      contentType: "text/plain",
    });
    assert.equal(sawAuthHeader, true);

    const downloaded = await adapter.getBuffer({ storageKey: "user1/sample.txt" });
    assert.equal(downloaded.toString("utf8"), "Confidential MSA");

    await adapter.deleteObject({ storageKey: "user1/sample.txt" });
    await assert.rejects(() => adapter.getBuffer({ storageKey: "user1/sample.txt" }));
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    mockS3.close();
  }
});

test("ExtractionJobQueue runs background jobs, emits progress, and reports metrics", async () => {
  const seenStages = [];
  const unsub = extractionQueue.subscribe("doc_queue_test", (ev) => {
    seenStages.push(ev.stage);
  });

  const job = extractionQueue.enqueue({
    contractId: "doc_queue_test",
    userId: "user_queue_test",
    taskFn: async (onProgress) => {
      onProgress("classifying", 60, "Classifying...");
      return { savedClausesCount: 4, vectorsIndexedCount: 4 };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  unsub();

  const finalJob = extractionQueue.getJob(job.id, "user_queue_test");
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.percent, 100);
  assert.ok(seenStages.includes("classifying"));
  assert.ok(seenStages.includes("completed"));

  const metricsText = renderPrometheusMetrics();
  assert.ok(metricsText.includes("lca_http_requests_total"));
  assert.ok(metricsText.includes("lca_extraction_jobs_active"));
});

test("S3StorageAdapter avoids duplicating bucket name when endpoint already includes bucket", () => {
  const prev = { S3_BUCKET: process.env.S3_BUCKET, S3_ENDPOINT: process.env.S3_ENDPOINT };
  process.env.S3_BUCKET = "contracts";
  process.env.S3_ENDPOINT = "https://acct.r2.cloudflarestorage.com/contracts";
  try {
    const adapter = new storageService.S3StorageAdapter();
    assert.equal(
      adapter._buildUrl("user1/doc.pdf"),
      "https://acct.r2.cloudflarestorage.com/contracts/user1/doc.pdf"
    );
  } finally {
    if (prev.S3_BUCKET === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = prev.S3_BUCKET;
    if (prev.S3_ENDPOINT === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = prev.S3_ENDPOINT;
  }
});

test("AiServicePool.probeHealth resets an OPEN circuit to CLOSED once /health/ready responds 200", async () => {
  let healthy = false;
  const srv = http.createServer((req, res) => {
    if (!healthy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "booting" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ready", llm_provider: "gemini", embedding_provider: "gemini" }));
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));

  const prevUrls = process.env.AI_SERVICE_URLS;
  process.env.AI_SERVICE_URLS = `http://127.0.0.1:${srv.address().port}`;
  try {
    // Trigger 3 failures to open the circuit
    for (let i = 0; i < 3; i++) {
      await aiClient.request("/api/v1/test", { timeoutMs: 2000 }).catch(() => {});
    }
    assert.equal(aiClient.getPoolStatus().nodes[0].circuitState, "OPEN");

    // Probe while still returning 503 reports waking
    const waking = await aiClient.probeHealth({ timeoutMs: 2000 });
    assert.equal(waking[0].reachable, false);
    assert.equal(waking[0].status, "waking");

    // Once healthy, probeHealth heals the circuit back to CLOSED
    healthy = true;
    const recovered = await aiClient.probeHealth({ timeoutMs: 2000 });
    assert.equal(recovered[0].reachable, true);
    assert.equal(recovered[0].status, "healthy");
    assert.equal(recovered[0].circuitState, "CLOSED");
    assert.equal(aiClient.getPoolStatus().healthyNodes, 1);
  } finally {
    if (prevUrls === undefined) delete process.env.AI_SERVICE_URLS;
    else process.env.AI_SERVICE_URLS = prevUrls;
    srv.close();
  }
});

test("AiServicePool seamlessly waits for a cold-starting AI worker and succeeds on first caller request", async () => {
  let ready = false;
  let draftHits = 0;

  const srv = http.createServer((req, res) => {
    if (req.url === "/health/ready") {
      if (!ready) {
        res.writeHead(503, { "Content-Type": "text/html" });
        res.end("<html>Service Waking Up</html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ready", llm_provider: "gemini", embedding_provider: "gemini" }));
      return;
    }
    if (req.url === "/api/v1/draft") {
      draftHits += 1;
      if (!ready) {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end("<html>Bad Gateway</html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ title: "Woken Draft MSA", full_text: "1. SCOPE\nBalanced agreement." }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const wakeTimer = setTimeout(() => {
    ready = true;
  }, 220);

  const prev = {
    AI_SERVICE_URLS: process.env.AI_SERVICE_URLS,
    AI_WAKEUP_TIMEOUT_MS: process.env.AI_WAKEUP_TIMEOUT_MS,
    AI_WAKEUP_POLL_MS: process.env.AI_WAKEUP_POLL_MS,
  };
  process.env.AI_SERVICE_URLS = `http://127.0.0.1:${srv.address().port}`;
  process.env.AI_WAKEUP_TIMEOUT_MS = "3000";
  process.env.AI_WAKEUP_POLL_MS = "60";

  try {
    const res = await aiClient.request("/api/v1/draft", {
      method: "POST",
      body: { contract_type: "msa" },
      timeoutMs: 3000,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, "Woken Draft MSA");
    assert.equal(draftHits, 2);
    assert.equal(aiClient.getPoolStatus().nodes[0].circuitState, "CLOSED");

    // Verify gateway HTML errors map to clean user-facing message
    const fakeGatewayRes = new Response("<html>502 Bad Gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const msg = await extractAiErrorMessage(fakeGatewayRes, "AI drafting request failed.");
    assert.match(msg, /waking up|temporarily busy/i);
  } finally {
    clearTimeout(wakeTimer);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    srv.close();
  }
});
