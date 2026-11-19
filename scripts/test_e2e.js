const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const AI_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";

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

async function isServerRunning(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return false;
}

async function ensureServicesRunning() {
  console.log("Checking service readiness...");

  if (!(await isServerRunning(`${AI_URL}/health`))) {
    console.log("  Starting AI service on port 8000...");
    const aiDir = path.join(__dirname, "../ai-service");
    const venvCandidates = [
      path.join(aiDir, ".venv/Scripts/python.exe"),
      path.join(aiDir, ".venv/bin/python"),
    ];
    const pythonBin = venvCandidates.find((p) => fs.existsSync(p)) || "python";
    spawnedAiProc = spawn(
      pythonBin,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
      { cwd: aiDir, stdio: "pipe" }
    );

    if (!(await waitForServer(`${AI_URL}/health`))) {
      throw new Error(`AI service did not become ready at ${AI_URL}.`);
    }
    console.log("  AI service ready.");
  } else {
    console.log("  AI service already running.");
  }

  if (!(await isServerRunning(`${BACKEND_URL}/health`))) {
    console.log("  Starting Express API on port 5000...");
    const rootDir = path.join(__dirname, "..");
    spawnedBackendProc = spawn(process.execPath, [path.join(rootDir, "backend/server.js")], {
      cwd: rootDir,
      stdio: "pipe",
    });

    if (!(await waitForServer(`${BACKEND_URL}/health`))) {
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

async function uploadMultipartContract(token, title, fileName, contentString) {
  const boundary = "----LegalAgentBoundary" + Math.random().toString(36).slice(2);
  const preBoundary = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="contract"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`;
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

  // 1. AI service health
  console.log("\n[1] AI service health telemetry");
  const healthRes = await fetch(`${AI_URL}/health`);
  assert(healthRes.status === 200, "AI /health returns HTTP 200");
  const healthData = await healthRes.json();
  assert(healthData.status === "healthy", "AI service reports healthy");
  assert(healthData.extractors_ready?.pdf === true, "PDF extractor ready");
  assert(healthData.extractors_ready?.docx === true, "DOCX extractor ready");
  assert(healthData.extractors_ready?.txt === true, "TXT extractor ready");
  assert(healthData.embeddings_ready === true, "Embeddings engine ready");
  assert(healthData.vector_store_ready === true, "ChromaDB store ready");
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

  // 3. Auth register & login
  console.log("\n[3] Authentication (register + login)");
  const uniqueEmail = `e2e_${Date.now()}@legalagent.test`;
  const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E Reviewer", email: uniqueEmail, password: "password123" }),
  });
  assert(regRes.status === 201, "POST /api/auth/register returns HTTP 201");
  const regData = await regRes.json();
  assert(Boolean(regData.token), "Registration returns JWT");
  const token = regData.token;

  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail, password: "password123" }),
  });
  assert(loginRes.status === 200, "POST /api/auth/login returns HTTP 200");

  // 4. Upload two contracts (v1 and v2) for extraction, Q&A, report, and comparison
  console.log("\n[4] Contract upload & AI extraction pipeline");
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

  // 5. Extract & analyze both contracts
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

  const ex2Res = await fetch(`${BACKEND_URL}/api/contracts/${contract2Id}/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(ex2Res.status === 200, "Extracted & analyzed Contract v2");

  // 6. Clauses, Summary & Report export
  console.log("\n[5] Clauses, summary, and Markdown report export");
  const clausesRes = await fetch(`${BACKEND_URL}/api/contracts/${contract1Id}/clauses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(clausesRes.status === 200, "GET /clauses returns HTTP 200");
  const clausesData = await clausesRes.json();
  assert(clausesData.count >= 3, `Retrieved ${clausesData.count} clauses from MongoDB`);

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

  // 7. Grounded Q&A & Hallucination defense
  console.log("\n[6] Grounded Q&A and out-of-scope rejection");
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
  assert(askData.answer.length > 0, "Grounded answer text returned");

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
  console.log(
    `  Diff summary: ${cmpData.counts.modified} modified, ${cmpData.counts.added} added, ${cmpData.counts.removed} removed, ${cmpData.counts.unchanged} unchanged`
  );

  // 10. Vector stats & cascade delete cleanup
  console.log("\n[9] Vector telemetry & cascade deletion cleanup");
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

  console.log(`\nCompleted: ${testsPassed} passed, ${testsFailed} failed.`);
  cleanupSpawnedProcesses();
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("E2E test failure:", err.message);
  cleanupSpawnedProcesses();
  process.exit(1);
});
