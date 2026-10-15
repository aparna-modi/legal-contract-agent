# 🎓 Legal Contract Agent — AI Service Viva & Mentor Demonstration Guide

**Project Title:** Legal Contract Agent  
**Students:** B S Tejender Singh (251810700282), Aparna Modi (251810700036)  
**Course:** Year 2026, Semester 3 — Batch B  
**Project Type:** Application Developer (Full-Stack + GenAI)  
**Milestone:** **Week 5 Complete** — Vector Database Integration (ChromaDB), Multi-Tenant Scoping, Hybrid Legal Reranker & Grounded Retrieval Pipeline  

---

## 🏛️ 1. Architecture & Design Overview

The **Legal Contract Agent** is built on a decoupled, production-grade 3-tier architecture with an isolated vector indexing and retrieval subsystem:

```
┌─────────────────────────────────────────────────────────────┐
│                      React 19 + Vite 8                      │
│      • Contract Repository           • Grounded Q&A Modal   │
│      • Semantic Library Search       • Live Citations UI    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON / JWT
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Node.js / Express 5 Gateway                 │
│   • JWT Auth & User Scoping       • Multer Disk Upload      │
│   • MongoDB System of Record      • Rate Limiting & Proxy   │
│   • POST /api/contracts/:id/ask   • POST /search (Library)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Internal HTTP (Port 8000)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Python 3.13 / FastAPI AI Microservice           │
│   • PDF / DOCX / TXT Extraction  • Legal-Aware Chunking     │
│   • Dense Semantic Embeddings    • Hybrid Legal Reranker    │
│   • Multi-Tenant ChromaDB Store  • Hallucination Threshold  │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Local Embedded HNSW
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               ChromaDB Vector Store (Disk/HNSW)             │
│   • Cosine Distance Metric        • Strict userId Isolation │
│   • Page / Section / Clause Meta  • Batch Upsert & Deletion │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Invariants for Week 5:
1. **Multi-Tenant Vector Isolation**:
   - Every chunk indexed into ChromaDB is tagged with mandatory `userId` and `documentId`.
   - Every similarity query enforces `where={"user_id": userId}`. User A can **never** retrieve User B's documents, guaranteed by automated security unit tests.
2. **Provider-Agnostic Vector Store Adapter**:
   - Implemented via [BaseVectorStore](file:///c:/OJT/legal-contract-agent/ai-service/services/vector_store.py) interface.
   - Development uses ChromaDB with persistent HNSW index. Can be swapped for Qdrant or FAISS in production with zero code changes.
3. **Hybrid Cross-Clause Reranking**:
   - Combines dense semantic cosine similarity (50%), legal terminology keyword weighting (25%), section heading alignment (10%), legal concept alignment (10%), and exact phrase bonus (5%).
4. **Hallucination Prevention**:
   - A minimum retrieval threshold (`min_score = 0.25`) blocks weak evidence. If no chunk meets the threshold, the system triggers `insufficient_information: True`, providing a clear factual disclaimer rather than guessing.

---

## ⚡ 2. Quickstart: How to Run the Complete Platform

### Option A: Run the Complete Full-Stack Platform
From the root repository (`c:\OJT\legal-contract-agent`):
```powershell
npm run dev
```
*This concurrently boots:*
1. **Backend API Gateway**: `http://localhost:5000`
2. **FastAPI AI Microservice**: `http://localhost:8000`
3. **React Client Dashboard**: `http://localhost:5173`

---

### Option B: Run Automated Week 5 Verification
Run the comprehensive empirical verification script:
```powershell
cd ai-service
uv run python ../scripts/verify_week5.py
```

Run the complete 32-test automated pytest suite:
```powershell
cd ai-service
uv run pytest
```

---

## 🌐 3. Interactive Documentation & Endpoints

Once the AI Service is running on `http://127.0.0.1:8000`:
- **Interactive Swagger UI**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Telemetry Health Endpoint**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

### Complete Endpoint Catalog:

| Method | Endpoint | Description | Payload |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Hardware telemetry, memory, extractors & vector store readiness | None |
| `POST` | `/api/v1/extract` | Multipart file upload parsing (`.pdf`, `.docx`, `.txt`) | `file` (binary), `embed` (bool) |
| `POST` | `/api/v1/extract-path` | Ingestion from server file path with automatic vector indexing | `{ file_path, user_id, document_id, index_vector }` |
| `POST` | `/api/v1/embed` | Dense vector embedding generation | `{ texts: ["..."] }` |
| `POST` | `/api/v1/similarity` | Cosine similarity calculation between two clauses | `{ text_a: "...", text_b: "..." }` |
| `POST` | `/api/v1/vector/index` | Batch chunk upsert into ChromaDB with multi-tenant isolation | `{ user_id, document_id, chunks: [...] }` |
| `POST` | `/api/v1/vector/delete` | Purge vectors for a document or user from ChromaDB | `{ user_id, document_id }` |
| `GET` | `/api/v1/vector/stats` | Vector collection statistics and user vector counts | Query param: `?user_id=...` |
| `POST` | `/api/v1/retrieve` | Grounded retrieval pipeline with reranking & citations | `{ query, user_id, document_id, top_k, min_score }` |

### Express Backend Endpoints (Port 5000):

| Method | Endpoint | Description | Payload |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/contracts/:id/extract` | Parses document, saves clauses to MongoDB, indexes into ChromaDB | Bearer JWT |
| `POST` | `/api/contracts/:id/ask` | Grounded Q&A against a specific contract with citations | `{ query, top_k, min_score }` |
| `POST` | `/api/contracts/search` | Cross-contract library semantic search | `{ query, top_k, min_score }` |
| `GET` | `/api/contracts/stats/vectors` | User vector collection telemetry | Bearer JWT |
| `DELETE` | `/api/contracts/:id` | Cascades contract deletion across disk, MongoDB, and ChromaDB | Bearer JWT |

---

## 🧪 4. Automated Testing & Verification Proof

Our test suite contains **32 automated tests** across 6 test modules in [ai-service/tests/](file:///c:/OJT/legal-contract-agent/ai-service/tests):

```
collected 32 items
tests\test_api.py .........                                              [ 28%]
tests\test_embeddings.py ........                                        [ 53%]
tests\test_extractors.py .......                                         [ 75%]
tests\test_retrieval_pipeline.py ...                                     [ 84%]
tests\test_vector_api.py .                                               [ 87%]
tests\test_vector_store.py ....                                          [100%]
============================= 32 passed in 1.76s ==============================
```

### Empirical Verification Checkpoint (`scripts/verify_week5.py`):
1. **ChromaDB Initialized**: HNSW Cosine Index with persistent storage.
2. **Chunk Upsert**: Complete schema preserved (`chunkId`, `documentId`, `userId`, `page_number`, `section`, `clause_type`).
3. **Multi-Tenant Isolation**: Proved that queries by unauthorized users return 0 results.
4. **Retrieval Accuracy**: Verified that termination and liability queries return exact target clauses with `Page X, Section Y` citations.
5. **Hallucination Defense**: Proved that irrelevant queries trigger `insufficient_information: True` and reject false matches.
6. **Cascade Cleanup**: Verified that document deletion purges all corresponding vectors from ChromaDB.

---

## 🖥️ 5. Step-by-Step Live Demonstration Guide for Mentors

To demonstrate Week 5 to mentors during review:
1. Boot the platform: `npm run dev`
2. Open [http://localhost:5173](http://localhost:5173) in Chrome.
3. Log in with your credentials or register a test account.
4. On the **Dashboard**, observe the new **ChromaDB Vectors** counter and the **Semantic Search Bar**.
5. Upload or view an existing contract:
   - Click **"⚡ Extract & Vectorize"**: Notice that clauses are extracted and vectors are immediately indexed into ChromaDB!
   - The contract badge shows both `Analyzed` and `🧠 Indexed`.
6. Click **"🤖 Ask AI"** on the contract card:
   - The **Grounded Q&A Modal** opens.
   - Click the prompt chip: *"What happens if I terminate early?"*
   - Observe the **Grounded Answer**, the **HIGH CONFIDENCE** indicator, and the clickable citation tags (`Page 3, Section: 'Termination'`).
   - Inspect the candidate passages showing composite relevance percentage scores.
7. Test **Hallucination Defense**:
   - Ask an irrelevant question, e.g. *"What is the policy on company spaceships?"*
   - Observe the amber **Hallucination Defense Triggered** banner: the system explains that relevance is below the safety threshold of 0.25 and refuses to guess!
8. Test **Library-Wide Semantic Search**:
   - Use the top search bar to search across all contracts simultaneously.

---

## 🎯 6. Viva Voce Q&A Cheat-Sheet (Milestone Week 5)

### Q1: What vector database did you integrate and why?
> **Answer:**  
> *"We integrated ChromaDB as our local, zero-friction vector store for development, encapsulated behind a clean `BaseVectorStore` adapter interface.  
> ChromaDB runs embedded with persistent SQLite/HNSW indexing, meaning mentors can clone and run our project immediately without running external cloud infrastructure or Docker containers.  
> Because we coded against an adapter interface, switching to Qdrant or Pinecone for production requires modifying only the adapter class—the Express backend, FastAPI endpoints, and retrieval logic remain 100% untouched."*

### Q2: How does your vector database handle multi-tenant isolation?
> **Answer:**  
> *"Multi-tenant isolation is enforced at the metadata layer. Every vector chunk indexed into ChromaDB includes `user_id` and `document_id`.  
> When a query is executed, we enforce a strict metadata filter: `where={"user_id": user_id}`.  
> As proven in our automated test `test_multi_tenant_isolation`, even if User B queries with the exact text of User A's confidential contract, ChromaDB filters out User A's chunks entirely at the index level. No unauthorized vectors are ever returned."*

### Q3: What is your hybrid reranking algorithm?
> **Answer:**  
> *"Dense vector similarity alone can be fooled by semantic drift or generic legal phrasing. Our `LegalReranker` calculates a composite score:  
> $$Score = 0.50 \cdot S_{dense} + 0.25 \cdot S_{lexical} + 0.10 \cdot S_{legal\_concept} + 0.10 \cdot S_{heading} + 0.05 \cdot S_{phrase}$$  
> - $S_{dense}$: Cosine similarity from our 384-d legal embeddings.  
> - $S_{lexical}$: Proportion of query keywords appearing in the clause.  
> - $S_{legal\_concept}$: Extra weight for domain terms like 'indemnity', 'termination', 'liability cap'.  
> - $S_{heading}$: Bonus if query keywords match the clause's section heading (e.g., matching 'termination' to Section 12 'Termination for Cause').  
> - $S_{phrase}$: Exact n-gram phrase alignment bonus."*

### Q4: How does the system prevent LLM hallucinations?
> **Answer:**  
> *"Per Section 3.4 of our OJT Project Design document, we enforce a strict verification threshold (`min_score = 0.25`).  
> If an uploaded contract does not contain relevant terms for a query, the candidate passages will score below 0.25.  
> When this occurs, the retrieval pipeline intercepts the request, flags `insufficient_information: True`, and returns an explicit refusal message explaining that the contract does not contain sufficient evidence. This completely eliminates hallucinated answers on absent contract terms."*

### Q5: How are citations generated and validated?
> **Answer:**  
> *"During Week 4 chunking, we extracted and preserved page numbers, character offsets, and section headings. When chunks are indexed into ChromaDB, this metadata is permanently bound to the vector.  
> During retrieval, each candidate passage returns a formatted citation: `Page {page_number}, Section: '{section_heading}' [{clause_type}]`. This enables legal auditors and users to immediately verify where every claim originated in the original document."*

---

## 📋 7. Summary of Completed Code Artifacts (Week 5)

- **AI Microservice**:
  - [ai-service/services/vector_store.py](file:///c:/OJT/legal-contract-agent/ai-service/services/vector_store.py): `BaseVectorStore` and `ChromaVectorStore` with persistent HNSW index and multi-tenant scoping.
  - [ai-service/services/retrieval_service.py](file:///c:/OJT/legal-contract-agent/ai-service/services/retrieval_service.py): `LegalReranker` and `RetrievalService` with thresholding and grounded synthesis.
  - [ai-service/main.py](file:///c:/OJT/legal-contract-agent/ai-service/main.py): Added endpoints `/api/v1/vector/index`, `/api/v1/vector/delete`, `/api/v1/vector/stats`, and `/api/v1/retrieve`.
  - [ai-service/services/health_service.py](file:///c:/OJT/legal-contract-agent/ai-service/services/health_service.py): Extended telemetry to report vector store collection stats.
  - [ai-service/tests/](file:///c:/OJT/legal-contract-agent/ai-service/tests): 32 automated tests covering unit vector ops, tenant isolation, reranking, and FastAPI endpoints.
- **Backend API Gateway**:
  - [backend/routes/contractRoutes.js](file:///c:/OJT/legal-contract-agent/backend/routes/contractRoutes.js): Integrated vector indexing on extraction, cascade vector deletion on contract delete, `POST /:id/ask` endpoint, `POST /search` cross-library search, and `GET /stats/vectors`.
  - [backend/models/Document.js](file:///c:/OJT/legal-contract-agent/backend/models/Document.js): Added `vectorIndexed` and `vectorCount` tracking fields.
- **Frontend Client**:
  - [frontend/src/pages/Dashboard.jsx](file:///c:/OJT/legal-contract-agent/frontend/src/pages/Dashboard.jsx): Semantic search bar with quick chips, "🤖 Ask AI" triggers, and Grounded Q&A modal with citations, confidence badges, and hallucination defense banners.
  - [frontend/src/index.css](file:///c:/OJT/legal-contract-agent/frontend/src/index.css): Modern styling for search inputs, confidence badges, and citation chips.
- **Evaluation & Verification**:
  - [scripts/verify_week5.py](file:///c:/OJT/legal-contract-agent/scripts/verify_week5.py): 6-step empirical verification test confirming vector store, tenant isolation, reranking, citations, hallucination defense, and cascade purge.
