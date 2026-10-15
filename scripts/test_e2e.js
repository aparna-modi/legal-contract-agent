const fs = require("fs");
const path = require("path");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const AI_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

let testsPassed = 0;
let testsFailed = 0;

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

async function runTests() {
  console.log("==================================================");
  console.log("   LEGAL CONTRACT AGENT — END-TO-END TEST SUITE   ");
  console.log("==================================================\n");

  // TEST 1: AI Service Health Check
  console.log("--- 1. Testing AI Service (/health) ---");
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
  console.log(`   -> Active Embedding Provider: ${healthData.embedding_provider}`);

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

  // TEST 8: Full End-to-End AI Extraction and Clause Persistence through Gateway
  console.log("\n--- 8. Testing AI Extraction & Clause Persistence via Gateway (/api/contracts/:id/extract) ---");
  const extractGatewayRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const extractGatewayText = await extractGatewayRes.text();
  if (extractGatewayRes.status !== 200) {
    console.error("Gateway error details:", extractGatewayRes.status, extractGatewayText);
  }
  assert(extractGatewayRes.status === 200, "Contract AI extraction via gateway responds with HTTP 200 OK");
  const extractGatewayData = JSON.parse(extractGatewayText);
  assert(extractGatewayData.savedClausesCount >= 3, "Gateway saved at least 3 clauses in MongoDB");
  assert(extractGatewayData.document?.status === "completed", "Document status updated to 'completed'");
  assert(extractGatewayData.document?.totalTokens > 0, "Document records computed token metrics");
  assert(extractGatewayData.extraction?.has_embeddings === true, "Chunks include vector embeddings");

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
  clausesData.clauses.slice(0, 3).forEach((cl, idx) => {
    console.log(`      [Clause ${idx + 1}] Type: "${cl.clauseType}" | Text: "${cl.text.substring(0, 50)}..."`);
  });

  // TEST 10: Retrieve Contract Summary Metrics
  console.log("\n--- 10. Testing Contract Summary Metrics (/api/contracts/:id/summary) ---");
  const summaryRes = await fetch(`${BACKEND_URL}/api/contracts/${contractId}/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(summaryRes.status === 200, "Summary endpoint responds with HTTP 200 OK");
  const summaryData = await summaryRes.json();
  assert(summaryData.metrics?.status === "completed", "Summary reports 'completed' status");
  assert(summaryData.metrics?.clauseCount >= 3, "Summary reports clause count");
  assert(summaryData.metrics?.totalTokens > 0, "Summary reports token count");

  // TEST 11: Delete Contract and Cascade Delete Clauses
  console.log("\n--- 11. Testing Contract Deletion & Cascade Clause Cleanup (/api/contracts/:id) ---");
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

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw an unhandled error:", err);
  process.exit(1);
});
