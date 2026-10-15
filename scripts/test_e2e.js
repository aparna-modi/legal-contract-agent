const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

let testsPassed = 0;
let testsFailed = 0;
let spawnedAiProc = null;
let spawnedBackendProc = null;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
    testsPassed++;
  }
}

async function isServerRunning(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(url)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function ensureServicesRunning() {
  console.log(">> Checking service readiness for End-to-End verification...");

  // 1. AI Service check / auto-spawn
  const aiRunning = await isServerRunning(`${AI_URL}/health`);
  if (!aiRunning) {
    console.log("   -> AI Microservice not detected on port 8000. Auto-spawning background instance...");
    const aiServiceDir = path.join(__dirname, "../ai-service");
    spawnedAiProc = spawn("uv", ["run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], {
      cwd: aiServiceDir,
      stdio: "pipe",
    });

    const ready = await waitForServer(`${AI_URL}/health`);
    if (!ready) {
      throw new Error(`AI Service failed to start within timeout on ${AI_URL}. Ensure uv and dependencies are installed.`);
    }
    console.log("   -> AI Service successfully booted and healthy!");
  } else {
    console.log("   ✓ AI Service detected running on port 8000.");
  }

  // 2. Backend check / auto-spawn
  const backendRunning = await isServerRunning(`${BACKEND_URL}/api/contracts`);
  if (!backendRunning) {
    console.log("   -> Backend Gateway not detected on port 5000. Auto-spawning background instance...");
    const rootDir = path.join(__dirname, "..");
    spawnedBackendProc = spawn(process.execPath, [path.join(rootDir, "backend/server.js")], {
      cwd: rootDir,
      stdio: "pipe",
    });

    const ready = await waitForServer(`${BACKEND_URL}/api/contracts`);
    if (!ready) {
      throw new Error(`Backend Gateway failed to start within timeout on ${BACKEND_URL}. Check MongoDB connection.`);
    }
    console.log("   -> Backend Gateway successfully booted on port 5000!");
  } else {
    console.log("   ✓ Backend Gateway detected running on port 5000.");
  }
}

function cleanupSpawnedProcesses() {
  if (spawnedAiProc && spawnedAiProc.pid) {
    try {
      if (process.platform === "win32") {
        require("child_process").execSync(`taskkill /pid ${spawnedAiProc.pid} /f /t`, { stdio: "ignore" });
      } else {
        spawnedAiProc.kill();
      }
    } catch {}
    spawnedAiProc = null;
  }
  if (spawnedBackendProc && spawnedBackendProc.pid) {
    try {
      if (process.platform === "win32") {
        require("child_process").execSync(`taskkill /pid ${spawnedBackendProc.pid} /f /t`, { stdio: "ignore" });
      } else {
        spawnedBackendProc.kill();
      }
    } catch {}
    spawnedBackendProc = null;
  }
}

process.on("exit", cleanupSpawnedProcesses);
process.on("SIGINT", () => {
  cleanupSpawnedProcesses();
  process.exit(1);
});


async function runTests() {
  console.log("==================================================");
  console.log("   LEGAL CONTRACT AGENT — END-TO-END TEST SUITE   ");
  console.log("==================================================\n");

  await ensureServicesRunning();

  // TEST 1: AI Service Health Check & Vector Store Readiness
  console.log("\n--- 1. Testing AI Service Telemetry (/health) ---");
  const healthRes = await fetch(`${AI_URL}/health`);
  assert(healthRes.status === 200, "AI Service /health responds with HTTP 200");
  const healthData = await healthRes.json();
  assert(healthData.status === "healthy", "AI Service status is 'healthy'");
  assert(healthData.system?.memory?.total_mb > 0, "AI Service reports memory metrics");
  assert(healthData.system?.cpu?.logical_cores > 0, "AI Service reports CPU cores");
  assert(healthData.extractors_ready?.pdf === true, "PDF extractor is ready");
  assert(healthData.extractors_ready?.docx === true, "DOCX extractor is ready");
  assert(healthData.extractors_ready?.txt === true, "TXT extractor is ready");
  assert(healthData.embeddings_ready === true, "Embeddings engine is ready");
  assert(healthData.vector_store_ready === true, "ChromaDB vector store is ready");
  console.log(`   -> Active Embedding Provider: ${healthData.embedding_provider}`);
  console.log(`   -> Vector Store Provider: ${healthData.vector_store?.provider}`);

  // TEST 2: Standalone Embedding Generation & Semantic Similarity
  console.log("\n--- 2. Testing AI Service Embeddings & Cosine Similarity ---");
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
  assert(embedRes.status === 200, "AI Service /api/v1/embed responds with HTTP 200");
  const embedData = await embedRes.json();
  assert(embedData.count === 2, "Returned embeddings for 2 texts");
  assert(embedData.dimension === 384, "Embedding dimension is 384");
  assert(embedData.embeddings[0].length === 384, "First embedding vector has length 384");

  const simRes = await fetch(`${AI_URL}/api/v1/similarity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text_a: "Governing law of this contract is the laws of New York.",
      text_b: "This agreement is governed by and construed under New York law.",
    }),
  });
  assert(simRes.status === 200, "AI Service /api/v1/similarity responds with HTTP 200");
  const simData = await simRes.json();
  assert(simData.similarity > 0.3, "Semantic similarity between legal clauses is positive and high");
  console.log(`   -> Semantic Similarity Score: ${simData.similarity}`);

  // TEST 3: AI Service Direct File Extraction (TXT) with Embeddings
  console.log("\n--- 3. Testing AI Service Direct File Extraction with Embeddings ---");
  const sampleTxt = `MASTER SERVICES AGREEMENT
1. DEFINITIONS
In this Agreement, Client and Service Provider agree to the following terms.

2. INDEMNIFICATION
Service Provider shall indemnify, defend, and hold harmless Client.
  (a) Indemnity includes reasonable attorney fees.
  (b) Claims must be notified within 30 days.

3. GOVERNING LAW
This Agreement is governed by the laws of California.`;

  const tmpTxtPath = path.join(__dirname, "temp_sample_contract.txt");
  fs.writeFileSync(tmpTxtPath, sampleTxt);

  const directExtractRes = await fetch(`${AI_URL}/api/v1/extract-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: tmpTxtPath, title: "temp_sample_contract.txt", embed: true }),
  });
  assert(directExtractRes.status === 200, "AI Service extracts sample text from local path");
  const directData = await directExtractRes.json();
  assert(directData.file_type === "txt", "Extracted file_type is 'txt'");
  assert(directData.total_sections >= 3, "Detected at least 3 sections");
  assert(directData.chunks.length >= 3, "Generated at least 3 structured chunks");
  assert(directData.total_tokens > 0, "Token count is computed via tiktoken");
  assert(directData.has_embeddings === true, "Chunks enriched with vector embeddings");
  assert(directData.chunks[0].embedding?.length === 384, "Chunk embedding has dimension 384");
  const hasSubclause = directData.chunks.some((c) => c.metadata?.is_subclause);
  assert(hasSubclause, "Subclauses (a) and (b) correctly identified");

  // TEST 4: User Registration
  console.log("\n--- 4. Testing Backend User Registration (/api/auth/register) ---");
  const uniqueEmail = `e2e_tester_${Date.now()}@legalagent.io`;
  const registerRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Test User",
      email: uniqueEmail,
      password: "password123",
    }),
  });
  assert(registerRes.status === 201, "User registration responds with HTTP 201 Created");
  const registerData = await registerRes.json();
  assert(!!registerData.token, "Registration returns JWT token");
  assert(registerData.user?.email === uniqueEmail, "User object returned matches registration");
  const token = registerData.token;

  // TEST 5: User Login
  console.log("\n--- 5. Testing Backend User Login (/api/auth/login) ---");
  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: uniqueEmail,
      password: "password123",
    }),
  });
  assert(loginRes.status === 200, "User login responds with HTTP 200 OK");
  const loginData = await loginRes.json();
  assert(!!loginData.token, "Login returns valid JWT token");

  // TEST 6: Contract Upload via Multer
  console.log("\n--- 6. Testing Contract Upload (/api/contracts/upload) ---");
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const fileContent = fs.readFileSync(tmpTxtPath);
  const filename = "temp_sample_contract.txt";

  const preBoundary = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nE2E Master Services Agreement\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="contract"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`;
  const postBoundary = `\r\n--${boundary}--\r\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(preBoundary, "utf8"),
    Buffer.from(fileHeader, "utf8"),
    fileContent,
    Buffer.from(postBoundary, "utf8"),
  ]);

  const uploadRes = await fetch(`${BACKEND_URL}/api/contracts/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });
  assert(uploadRes.status === 201, "Contract upload responds with HTTP 201 Created");
  const uploadData = await uploadRes.json();
  assert(!!uploadData.document?._id, "Upload returns saved MongoDB Document with _id");
  assert(uploadData.document.status === "uploaded", "Document status is initially 'uploaded'");
  assert(uploadData.document.fileType === "txt", "Document fileType is 'txt'");
  const contractId = uploadData.document._id;

  // TEST 7: List Contracts
  console.log("\n--- 7. Testing List Contracts (/api/contracts) ---");
  const listRes = await fetch(`${BACKEND_URL}/api/contracts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(listRes.status === 200, "List contracts responds with HTTP 200 OK");
  const listData = await listRes.json();
  assert(Array.isArray(listData.contracts), "Contracts array returned");
  assert(
    listData.contracts.some((c) => c._id === contractId),
    "Uploaded contract is present in user's repository"
  );

  // TEST 8: Full End-to-End AI Extraction and Clause Persistence through Gateway + ChromaDB Indexing
  console.log("\n--- 8. Testing AI Extraction, Clause Persistence & Vector Indexing (/api/contracts/:id/extract) ---");
  const extractGatewayRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const extractGatewayText = await extractGatewayRes.text();
  assert(extractGatewayRes.status === 200, "Contract AI extraction via gateway responds with HTTP 200 OK");
  const extractGatewayData = JSON.parse(extractGatewayText);
  assert(extractGatewayData.savedClausesCount >= 3, "Gateway saved at least 3 clauses in MongoDB");
  assert(extractGatewayData.vectorsIndexedCount >= 3, "Vectors successfully indexed into ChromaDB");
  assert(extractGatewayData.document?.status === "completed", "Document status updated to 'completed'");
  assert(extractGatewayData.document?.vectorIndexed === true, "Document record flags vectorIndexed = true");
  assert(extractGatewayData.document?.vectorCount >= 3, "Document records vectorCount in MongoDB");

  // TEST 9: Retrieve Saved Clauses from MongoDB Collection
  console.log("\n--- 9. Testing Retrieve Extracted Clauses from MongoDB (/api/contracts/:id/clauses) ---");
  const clausesRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/clauses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(clausesRes.status === 200, "Get clauses endpoint responds with HTTP 200 OK");
  const clausesData = await clausesRes.json();
  assert(Array.isArray(clausesData.clauses), "Clauses list returned");
  assert(clausesData.count >= 3, "At least 3 clauses retrieved from MongoDB");
  console.log(`   -> Extracted & Persisted Clauses Count: ${clausesData.count}`);

  // TEST 10: Contract Summary Metrics
  console.log("\n--- 10. Testing Contract Summary Metrics (/api/contracts/:id/summary) ---");
  const summaryRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(summaryRes.status === 200, "Summary endpoint responds with HTTP 200 OK");
  const summaryData = await summaryRes.json();
  assert(summaryData.metrics?.status === "completed", "Summary reports 'completed' status");
  assert(summaryData.metrics?.clauseCount >= 3, "Summary reports clause count");
  assert(summaryData.metrics?.vectorIndexed === true, "Summary confirms vector indexing");

  // TEST 11: Week 5 Vector Telemetry Stats Endpoint
  console.log("\n--- 11. Testing Vector Store Telemetry (/api/contracts/stats/vectors) ---");
  const vectorStatsRes = await fetch(`${BACKEND_URL}/api/contracts/stats/vectors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(vectorStatsRes.status === 200, "Vector stats endpoint responds with HTTP 200 OK");
  const vectorStats = await vectorStatsRes.json();
  assert(vectorStats.user_vectors >= 3, "User vectors registered in ChromaDB collection");
  console.log(`   -> User Vector Count in ChromaDB: ${vectorStats.user_vectors}`);

  // TEST 12: Week 5 Grounded Contract Q&A with Citations (/api/contracts/:id/ask)
  console.log("\n--- 12. Testing Grounded Contract Q&A via Retrieval Pipeline (/api/contracts/:id/ask) ---");
  const askRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/ask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "What are the indemnification terms and attorney fees conditions?",
      top_k: 3,
      min_score: 0.20,
    }),
  });
  assert(askRes.status === 200, "Contract Q&A endpoint responds with HTTP 200 OK");
  const askData = await askRes.json();
  assert(askData.insufficient_information === false, "Indemnity query found sufficient grounded evidence");
  assert(askData.results?.length > 0, "Retrieved candidate passages");
  assert(askData.citations?.length > 0, "Generated structured page/section citations");
  assert(askData.answer.length > 0, "Returned grounded synthesis answer");
  console.log(`   -> Top Citation: ${askData.citations[0]}`);
  console.log(`   -> Answer Excerpt: ${askData.answer.substring(0, 90)}...`);

  // TEST 13: Week 5 Hallucination Defense Triggering
  console.log("\n--- 13. Testing Hallucination Defense Fallback (/api/contracts/:id/ask) ---");
  const fakeRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/ask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "What are the reimbursement policies for interstellar rocket fuel?",
      top_k: 3,
      min_score: 0.35,
    }),
  });
  assert(fakeRes.status === 200, "Unrelated question handled gracefully with HTTP 200");
  const fakeData = await fakeRes.json();
  assert(fakeData.insufficient_information === true, "Hallucination defense flagged insufficient_information = true");
  assert(fakeData.message.includes("Insufficient information"), "Refusal explanation returned");

  // TEST 14: Week 5 Library-Wide Cross-Contract Semantic Search (/api/contracts/search)
  console.log("\n--- 14. Testing Cross-Contract Library Search (/api/contracts/search) ---");
  const searchRes = await fetch(`${BACKEND_URL}/api/contracts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "California governing law",
      top_k: 2,
    }),
  });
  assert(searchRes.status === 200, "Cross-contract search responds with HTTP 200 OK");
  const searchData = await searchRes.json();
  assert(searchData.results?.length > 0, "Cross-contract search returned matching clauses");
  assert(searchData.results[0].contractTitle === "E2E Master Services Agreement", "Results enriched with contract title");

  // TEST 15: Delete Contract and Cascade Delete from Disk, Mongo, and ChromaDB
  console.log("\n--- 15. Testing Contract Deletion & ChromaDB Vector Purge (/api/contracts/:id) ---");
  const deleteRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(deleteRes.status === 200, "Contract deletion responds with HTTP 200 OK");
  const listAfterDelete = await (
    await fetch(`${BACKEND_URL}/api/contracts`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  assert(
    !listAfterDelete.contracts.some((c) => c._id === contractId),
    "Contract is removed from repository"
  );

  // Clean up scratch file
  if (fs.existsSync(tmpTxtPath)) {
    fs.unlinkSync(tmpTxtPath);
  }

  console.log("\n==================================================");
  console.log(`   ALL TESTS COMPLETED: ${testsPassed} PASSED, ${testsFailed} FAILED   `);
  console.log("==================================================");

  cleanupSpawnedProcesses();
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test execution threw an unhandled error:", err);
  cleanupSpawnedProcesses();
  process.exit(1);
});

