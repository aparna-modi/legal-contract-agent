const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

let BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
let AI_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";

let testsPassed = 0;
let testsFailed = 0;
let spawnedAiProc = null;
let spawnedBackendProc = null;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    testsFailed++;
    throw new Error(message);
  }
  console.log(`  [PASS] ${message}`);
  testsPassed++;
}

async function probeService(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (res.status === 200) {
      const data = await res.json().catch(() => null);
      if (data && data.status === "healthy") return "healthy";
    }
    return "occupied";
  } catch {
    return "free";
  }
}

async function waitForHealthy(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await probeService(url)) === "healthy") return true;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return false;
}

async function ensureServicesRunning() {
  console.log("Checking service readiness...");

  let aiPort = Number(new URL(AI_URL).port || 8000);
  const aiState = await probeService(`${AI_URL}/health`);
  if (aiState !== "healthy") {
    if (aiState === "occupied") {
      aiPort = 8011;
      AI_URL = `http://127.0.0.1:${aiPort}`;
      console.log(`  Port 8000 is in use by another process; starting AI service on port ${aiPort}...`);
    } else {
      console.log(`  Starting AI service on port ${aiPort}...`);
    }
    const aiDir = path.join(__dirname, "../ai-service");
    const venvCandidates = [
      path.join(aiDir, ".venv/Scripts/python.exe"),
      path.join(aiDir, ".venv/bin/python"),
    ];
    const pythonBin = venvCandidates.find((p) => fs.existsSync(p)) || "python";
    spawnedAiProc = spawn(
      pythonBin,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(aiPort)],
      { cwd: aiDir, stdio: "pipe" }
    );

    if (!(await waitForHealthy(`${AI_URL}/health`))) {
      throw new Error(`AI service did not become ready at ${AI_URL}.`);
    }
    console.log("  AI service ready.");
  } else {
    console.log("  AI service already running.");
  }

  let backendPort = Number(new URL(BACKEND_URL).port || 5000);
  const backendState = await probeService(`${BACKEND_URL}/health`);
  if (backendState !== "healthy" || aiPort !== 8000) {
    if (backendState !== "free") {
      backendPort = 5011;
      BACKEND_URL = `http://127.0.0.1:${backendPort}`;
      console.log(`  Starting isolated Express API on port ${backendPort}...`);
    } else {
      console.log(`  Starting Express API on port ${backendPort}...`);
    }
    const rootDir = path.join(__dirname, "..");
    spawnedBackendProc = spawn(process.execPath, [path.join(rootDir, "backend/server.js")], {
      cwd: rootDir,
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: String(backendPort),
        AI_SERVICE_URL: AI_URL,
      },
    });

    if (!(await waitForHealthy(`${BACKEND_URL}/health`))) {
      throw new Error(`Backend API did not become ready at ${BACKEND_URL}. Check MongoDB settings.`);
    }
    console.log("  Express API ready.");
  } else {
    console.log("  Express API already running.");
  }
}

function killProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${proc.pid} /f /t`, { stdio: "ignore" });
    } else {
      proc.kill();
    }
  } catch {
    // Ignore if already exited.
  }
}

function cleanupSpawnedProcesses() {
  killProc(spawnedAiProc);
  killProc(spawnedBackendProc);
  spawnedAiProc = null;
  spawnedBackendProc = null;
}

process.on("exit", cleanupSpawnedProcesses);
process.on("SIGINT", () => {
  cleanupSpawnedProcesses();
  process.exit(1);
});

function extractRefreshCookie(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/lca_refresh_token=([^;]+)/);
  return match ? `lca_refresh_token=${match[1]}` : "";
}

async function uploadMultipartContract(token, title, fileName, contentString, contentType = "text/plain") {
  const boundary = "----LegalAgentBoundary" + Math.random().toString(36).slice(2);
  const preBoundary = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="contract"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const postBoundary = `\r\n--${boundary}--\r\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(preBoundary, "utf8"),
    Buffer.from(fileHeader, "utf8"),
    Buffer.from(contentString, "utf8"),
    Buffer.from(postBoundary, "utf8"),
  ]);

  return fetch(`${BACKEND_URL}/api/contracts/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });
}

async function runTests() {
  console.log("Running Legal Contract Agent end-to-end verification...\n");
  await ensureServicesRunning();

  // 1. AI service health & probes
  console.log("\n[1] AI service health & readiness probes");
  const healthRes = await fetch(`${AI_URL}/health`);
  assert(healthRes.status === 200, "AI /health returns HTTP 200");
  const healthData = await healthRes.json();
  assert(healthData.status === "healthy", "AI service reports healthy");
  assert(healthData.extractors_ready?.pdf === true, "PDF extractor ready");
  assert(healthData.extractors_ready?.docx === true, "DOCX extractor ready");
  assert(healthData.extractors_ready?.txt === true, "TXT extractor ready");
  assert(healthData.embeddings_ready === true, "Embeddings engine ready");
  assert(healthData.vector_store_ready === true, "ChromaDB store ready");

  const readyRes = await fetch(`${BACKEND_URL}/health/ready`);
  assert(readyRes.status === 200, "Backend /health/ready returns HTTP 200");
  assert(Boolean(readyRes.headers.get("x-request-id")), "Backend attaches X-Request-Id header");
  console.log(`  Embedding provider: ${healthData.embedding_provider}`);
  console.log(`  LLM provider:       ${healthData.llm_provider}`);

  // 2. Embeddings & cosine similarity
  console.log("\n[2] Embeddings and semantic similarity");
  const embedRes = await fetch(`${AI_URL}/api/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [
        "Party A shall indemnify Party B from third-party claims.",
        "Either party may terminate this agreement with 30 days notice.",
      ],
    }),
  });
  assert(embedRes.status === 200, "/api/v1/embed returns HTTP 200");
  const embedData = await embedRes.json();
  assert(embedData.count === 2 && embedData.dimension === 384, "Returned two 384-d vectors");

  const simRes = await fetch(`${AI_URL}/api/v1/similarity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_a: "Governing law of this contract is the laws of New York.",
      text_b: "This agreement is governed by and construed under New York law.",
    }),
  });
  assert(simRes.status === 200, "/api/v1/similarity returns HTTP 200");
  const simData = await simRes.json();
  assert(simData.similarity > 0.3, `Positive legal similarity (${simData.similarity})`);

  // 3. Hardened Authentication (password policy, register, login, refresh rotation, RBAC)
  console.log("\n[3] Authentication, rotating refresh tokens & RBAC");
  const weakReg = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Weak User", email: `weak_${Date.now()}@legalagent.test`, password: "123" }),
  });
  assert(weakReg.status === 400, "Weak password rejected with HTTP 400");

  const uniqueEmail = `e2e_${Date.now()}@legalagent.test`;
  const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Reviewer",
      email: uniqueEmail,
      password: "password123",
      organization: "E2E Legal Ops",
    }),
  });
  assert(regRes.status === 201, "POST /api/auth/register returns HTTP 201");
  const regData = await regRes.json();
  assert(Boolean(regData.token), "Registration returns short-lived JWT");
  assert(regData.user?.role === "reviewer", "New user defaults to reviewer RBAC role");

  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail, password: "password123" }),
  });
  assert(loginRes.status === 200, "POST /api/auth/login returns HTTP 200");
  const initialCookie = extractRefreshCookie(loginRes);
  assert(Boolean(initialCookie), "Login issues HttpOnly refresh cookie");

  // Rotate refresh token once
  const refreshRes = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: initialCookie },
  });
  assert(refreshRes.status === 200, "POST /api/auth/refresh rotates refresh token");
  const refreshData = await refreshRes.json();
  let token = refreshData.token;
  assert(Boolean(token), "Refresh returns fresh access JWT");

  // Replaying the old rotated refresh token must trigger family revocation (401)
  const replayRes = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: initialCookie },
  });
  assert(replayRes.status === 401, "Replayed refresh token rejected (theft detection)");

  // Verify /api/auth/me, /api/auth/sessions, /api/system/status, and RBAC 403
  const meRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(meRes.status === 200, "GET /api/auth/me returns profile");

  const sysRes = await fetch(`${BACKEND_URL}/api/system/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(sysRes.status === 200, "GET /api/system/status returns live infrastructure telemetry");

  const adminRes = await fetch(`${BACKEND_URL}/api/system/admin/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(adminRes.status === 403, "RBAC blocks non-admin from /api/system/admin/audit (403)");

  // 4. Upload validation (magic-byte check) & two contracts for extraction
  console.log("\n[4] Magic-byte upload security & stateless AI extraction pipeline");
  const fakePdfRes = await uploadMultipartContract(
    token,
    "Disguised Payload",
    "malicious.pdf",
    "<script>alert(1)</script> fake pdf content",
    "application/pdf"
  );
  assert(fakePdfRes.status === 400, "Magic-byte validation rejects disguised PDF upload (400)");

  const contractV1Text = `MASTER SERVICES AGREEMENT
Effective January 15, 2026 between Acme Cloud Inc. and Northstar Consulting LLC for an initial term of 12 months.

1. PAYMENT TERMS
Client shall pay $10,000 per month within 30 days of invoice receipt.

2. INDEMNIFICATION
Service Provider shall indemnify, defend, and hold harmless Client against third-party claims.
  (a) Indemnity includes reasonable attorney fees.
  (b) Claims must be notified within 30 days.

3. TERMINATION
Either party may terminate this agreement upon 30 days prior written notice.

4. GOVERNING LAW
This Agreement is governed by the laws of California.`;

  const contractV2Text = `MASTER SERVICES AGREEMENT (REVISED)
Effective January 15, 2026 between Acme Cloud Inc. and Northstar Consulting LLC for an initial term of 24 months.

1. PAYMENT TERMS
Client shall pay $14,500 per month within 15 days of invoice receipt.

2. TERMINATION
Service Provider may terminate immediately without notice upon any missed payment.

3. LIMITATION OF LIABILITY
Total aggregate liability under this agreement shall not exceed $50,000.

4. GOVERNING LAW
This Agreement is governed by the laws of California.`;

  const up1Res = await uploadMultipartContract(token, "Vendor MSA v1", "msa_v1.txt", contractV1Text);
  assert(up1Res.status === 201, "Uploaded Contract v1");
  const contract1Id = (await up1Res.json()).document._id;

  const up2Res = await uploadMultipartContract(token, "Vendor MSA v2", "msa_v2.txt", contractV2Text);
  assert(up2Res.status === 201, "Uploaded Contract v2");
  const contract2Id = (await up2Res.json()).document._id;

  // Cross-tenant isolation check: a second user must receive 403 on User 1's contract
  const otherEmail = `other_${Date.now()}@legalagent.test`;
  const otherReg = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Other Tenant", email: otherEmail, password: "password123" }),
  });
  const otherToken = (await otherReg.json()).token;
  const crossTenantRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert(crossTenantRes.status === 403, "Cross-tenant access to another user's contract returns 403");

  // 5. Extract & analyze both contracts via stateless multipart forwarding
  const ex1Res = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(ex1Res.status === 200, "Extracted & analyzed Contract v1");
  const ex1Data = await ex1Res.json();
  assert(ex1Data.savedClausesCount >= 3, "Saved classified clauses for v1");
  assert(ex1Data.document.status === "completed", "v1 status updated to completed");
  assert(ex1Data.document.vectorIndexed === true, "v1 vectors indexed");
  assert(Boolean(ex1Data.document.summary), "Executive summary persisted on v1");
  assert(Array.isArray(ex1Data.document.missingClauses), "Missing clauses array persisted on v1");
  assert(typeof ex1Data.document.riskSummary?.score === "number", "Risk score persisted on v1");

  const ex2Res = await fetch(`${BACKEND_URL}/api/contracts/${contract2Id}/extract-async`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(ex2Res.status === 202, "Enqueued async extraction job for Contract v2 (202)");
  const ex2Queued = await ex2Res.json();
  assert(Boolean(ex2Queued.jobId), "Async extraction returns jobId");

  let asyncDone = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const jobRes = await fetch(`${BACKEND_URL}/api/contracts/jobs/${ex2Queued.jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jobData = await jobRes.json();
    if (jobData.job?.status === "completed") {
      asyncDone = true;
      break;
    }
    if (jobData.job?.status === "failed") {
      throw new Error(`Async job failed: ${jobData.job?.error}`);
    }
  }
  assert(asyncDone, "Async background extraction job completed for Contract v2");

  // 5b. Source file streaming, Playbook evaluation, Clause Redline, Team RBAC, Metrics & Password Reset
  console.log("\n[4b] Source document stream, Playbook, AI Redlines, Team RBAC & Metrics");
  const fileStreamRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(fileStreamRes.status === 200, "GET /file streams original contract for Document Viewer");

  const pbRes = await fetch(`${BACKEND_URL}/api/playbook`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(pbRes.status === 200, "GET /api/playbook returns default firm playbook");

  const presetsRes = await fetch(`${BACKEND_URL}/api/playbook/presets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(presetsRes.status === 200, "GET /api/playbook/presets returns jurisdiction rule packs");
  const presetsData = await presetsRes.json();
  assert((presetsData.presets || []).length >= 3, "At least 3 jurisdiction presets available");

  const applyPresetRes = await fetch(`${BACKEND_URL}/api/playbook/presets/us_commercial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(applyPresetRes.status === 200, "POST /api/playbook/presets/:id applies jurisdiction pack");

  const pbEvalRes = await fetch(`${BACKEND_URL}/api/playbook/evaluate/${contract1Id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(pbEvalRes.status === 200, "POST /api/playbook/evaluate/:id evaluates contract compliance");
  const pbEvalData = await pbEvalRes.json();
  assert(typeof pbEvalData.compliance_score === "number", `Playbook compliance score: ${pbEvalData.compliance_score}%`);

  const teamRes = await fetch(`${BACKEND_URL}/api/team`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(teamRes.status === 200, "GET /api/team initializes Organization workspace");
  const teamData = await teamRes.json();
  assert(Boolean(teamData.organization?.inviteCode), "Organization admin receives workspace invite code");

  const adminOverviewRes = await fetch(`${BACKEND_URL}/api/system/admin/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(adminOverviewRes.status === 200, "GET /api/system/admin/overview returns cross-account platform stats for admin");
  const adminOverview = await adminOverviewRes.json();
  assert(adminOverview.users?.total >= 2 && adminOverview.contracts?.total >= 2, "Admin overview aggregates accounts and contracts");

  const metricsRes = await fetch(`${BACKEND_URL}/metrics`);
  assert(metricsRes.status === 200, "GET /metrics exposes Prometheus telemetry");
  const metricsBody = await metricsRes.text();
  assert(metricsBody.includes("lca_http_requests_total"), "Prometheus metrics include HTTP counters");

  // 6. Clauses, Summary & Report export
  console.log("\n[5] Clauses, AI Redline Suggestion, summary, and Markdown report export");
  const clausesRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/clauses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(clausesRes.status === 200, "GET /clauses returns HTTP 200");
  const clausesData = await clausesRes.json();
  assert(clausesData.count >= 3, `Retrieved ${clausesData.count} clauses from MongoDB`);
  assert(
    clausesData.clauses.every((c) => Boolean(c.plainEnglish) && Boolean(c.indianLawRef)),
    "Every extracted clause includes plain-English explanation and Indian law reference"
  );

  const firstClauseId = clausesData.clauses[0]?._id;
  const redlineRes = await fetch(
    `${BACKEND_URL}/api/contracts/${contract1Id}/clauses/${firstClauseId}/suggest-redline`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  assert(redlineRes.status === 200, "POST /suggest-redline drafts fallback clause wording");
  const redlineData = await redlineRes.json();
  assert(Boolean(redlineData.suggested_text), "Suggested redline contains alternative wording");

  const summaryRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(summaryRes.status === 200, "GET /summary returns HTTP 200");
  const summaryData = await summaryRes.json();
  assert(summaryData.metrics?.status === "completed", "Summary confirms completed status");

  const reportRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(reportRes.status === 200, "GET /report returns HTTP 200");
  const reportText = await reportRes.text();
  assert(reportText.includes("# Contract Analysis Report:"), "Report contains Markdown heading");
  assert(reportText.includes("## Executive Summary"), "Report includes Executive Summary");

  const risksRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/risks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(risksRes.status === 200, "GET /risks returns HTTP 200");
  const risksData = await risksRes.json();
  assert(Array.isArray(risksData.flaggedClauses), "GET /risks returns flaggedClauses array");

  // 7. Grounded Q&A, Persistence, Feedback & Hallucination defense
  console.log("\n[6] Grounded Q&A, history, feedback, and out-of-scope rejection");
  const askRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "What are the indemnification terms and attorney fees conditions?",
      top_k: 3,
      min_score: 0.20,
    }),
  });
  assert(askRes.status === 200, "POST /ask returns HTTP 200");
  const askData = await askRes.json();
  assert(askData.insufficient_information === false, "Indemnity query answered with grounded evidence");
  assert(askData.citations?.length > 0, "Structured citations returned");
  assert(Array.isArray(askData.indian_law_refs) && askData.indian_law_refs.length > 0, "Indian law Act & Section references returned");
  assert(askData.answer.length > 0, "Grounded answer text returned");
  assert(Boolean(askData.qaId), "Persisted Q&A record returns qaId");

  const cachedAskRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "What are the indemnification terms and attorney fees conditions?",
      top_k: 3,
      min_score: 0.20,
    }),
  });
  const cachedAskData = await cachedAskRes.json();
  assert(cachedAskRes.status === 200 && cachedAskData.cached === true, "Repeated Q&A query served from cache");

  const fbRes = await fetch(`${BACKEND_URL}/api/feedback`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ qaId: askData.qaId, rating: "up", comment: "Clear citation" }),
  });
  assert(fbRes.status === 200, "POST /api/feedback saves user rating");

  const qaHistRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/qa`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(qaHistRes.status === 200, "GET /qa returns saved history");
  const qaHistData = await qaHistRes.json();
  assert(
    qaHistData.count >= 1 && qaHistData.history.some((h) => String(h._id) === String(askData.qaId) && h.feedback?.rating === "up"),
    "Q&A history includes saved feedback"
  );

  const oosRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "What are the reimbursement policies for interstellar rocket fuel?",
      top_k: 3,
      min_score: 0.25,
    }),
  });
  assert(oosRes.status === 200, "Out-of-scope query handled gracefully");
  const oosData = await oosRes.json();
  assert(oosData.insufficient_information === true, "Out-of-scope query rejected with insufficient_information=true");

  // 8. Cross-contract semantic search
  console.log("\n[7] Cross-contract library search");
  const searchRes = await fetch(`${BACKEND_URL}/api/contracts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "California governing law", top_k: 3 }),
  });
  assert(searchRes.status === 200, "POST /search returns HTTP 200");
  const searchData = await searchRes.json();
  assert(searchData.results?.length > 0, "Library search returned matches");
  assert(Boolean(searchData.results[0].contractTitle), "Search results include contract titles");

  // 9. Contract-to-contract comparison
  console.log("\n[8] Contract-to-contract comparison");
  const cmpRes = await fetch(`${BACKEND_URL}/api/contracts/compare`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contractAId: contract1Id, contractBId: contract2Id }),
  });
  assert(cmpRes.status === 200, "POST /compare returns HTTP 200");
  const cmpData = await cmpRes.json();
  assert(Boolean(cmpData.executive_summary), "Comparison generated executive summary");
  assert(cmpData.counts?.unchanged >= 1, "Comparison detected unchanged Governing Law clause");
  assert(cmpData.counts?.modified >= 2, "Comparison detected modified Payment & Termination clauses");
  assert(cmpData.counts?.added >= 1 && cmpData.counts?.removed >= 1, "Comparison detected added Liability & removed Indemnity clauses");

  // 10. Workspace Analytics & Audit Trail
  console.log("\n[9] Portfolio analytics and audit trail");
  const analyticsRes = await fetch(`${BACKEND_URL}/api/analytics/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(analyticsRes.status === 200, "GET /api/analytics/overview returns HTTP 200");
  const analyticsData = await analyticsRes.json();
  assert(analyticsData.portfolio?.analyzedContracts >= 2, "Analytics counts analyzed contracts");
  assert(analyticsData.qaMetrics?.feedbackUp >= 1, "Analytics aggregates feedback ratings");
  assert(analyticsData.recentActivity?.length >= 3, "Audit log recorded recent actions");

  // 11. Vector stats, cascade deletion & global token revocation
  console.log("\n[10] Vector telemetry, cascade deletion & global session revocation");
  const statsRes = await fetch(`${BACKEND_URL}/api/contracts/stats/vectors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(statsRes.status === 200, "GET /stats/vectors returns HTTP 200");
  const statsData = await statsRes.json();
  assert(statsData.user_vectors >= 6, `User vectors indexed (${statsData.user_vectors})`);

  for (const id of [contract1Id, contract2Id]) {
    const delRes = await fetch(`${BACKEND_URL}/api/contracts/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(delRes.status === 200, `Deleted contract ${id}`);
  }

  const afterDelStats = await (
    await fetch(`${BACKEND_URL}/api/contracts/stats/vectors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  assert(afterDelStats.user_vectors === 0, "All user vectors purged from ChromaDB after deletion");

  // Global revocation must instantly invalidate the current access JWT
  const logoutAllRes = await fetch(`${BACKEND_URL}/api/auth/logout-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(logoutAllRes.status === 200, "POST /api/auth/logout-all revokes all sessions");

  const revokedCheck = await fetch(`${BACKEND_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(revokedCheck.status === 401, "Previously valid JWT immediately rejected after logout-all (401)");

  console.log(`\nCompleted: ${testsPassed} passed, ${testsFailed} failed.`);
  cleanupSpawnedProcesses();
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("E2E test failure:", err.message);
  cleanupSpawnedProcesses();
  process.exit(1);
});
