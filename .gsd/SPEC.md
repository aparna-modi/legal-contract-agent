# SPEC.md — Legal Contract Agent Specification

> **Status**: `FINALIZED`
>
> ⚠️ **Planning Lock**: Requirements approved based on OJT Project Design Document (12 Weeks).

## Vision
Contracts are dense, repetitive, and written in legalese that non-lawyers struggle to navigate. The Legal Contract Agent is an AI-powered system designed to analyze legal contracts (PDF, DOCX, TXT), perform legal-aware chunking and embedding, store vectors in an isolated vector database (ChromaDB), and execute grounded retrieval and re-ranking for reliable legal question answering and clause analysis without hallucinations.

## Core Milestones & Weeks
- **Week 1**: Requirements, architecture, and scaffolding (React, Express, FastAPI) [Completed]
- **Week 2**: Authentication (JWT), password hashing, and core MongoDB schemas (Users, Documents) [Completed]
- **Week 3**: Contract upload endpoint, file validation, storage, and metadata capture [Completed]
- **Week 4**: Text extraction (PDF/DOCX/TXT), cleaning, legal-aware clause chunking, and embedding generation [Completed]
- **Week 5**: Vector database integration (ChromaDB/FAISS) and the retrieval pipeline (similarity search + reranking) [CURRENT TARGET]
- **Week 6**: Automatic summarisation, clause extraction, and classification
- **Week 7**: Risk detection engine: rule-based checks, severity scoring, missing-clause detection
- **Week 8**: Contract Q&A with grounded, cited answers — MVP feature-complete
- **Week 9**: Contract-to-contract comparison: clause matching and difference detection
- **Week 10**: Dashboard, risk visualisation, downloadable reports, and front-end polish
- **Week 11**: Evaluation (retrieval/generation metrics), security review, and test coverage
- **Week 12**: Deployment (Docker, cloud hosting), documentation, and final demonstration

## Week 5 Requirements: Vector Database Integration & Retrieval Pipeline
1. **Vector Database Integration (ChromaDB / Provider-Agnostic Adapter)**:
   - Persistent ChromaDB storage with collection management.
   - Provider-agnostic adapter interface allowing migration to FAISS or Qdrant.
   - Chunk metadata schema containing: `userId`, `documentId`, `chunkId`, `page_number`, `section`, `clause_number`, `clause_type`, `document_version`, `text`.
   - Strict multi-tenant security: every vector query applies `userId` filtering (and optional `documentId` filtering). No cross-user leakage.
   - Batch chunk upsert and document-level deletion.

2. **Retrieval Pipeline**:
   - Query embedding using unified `EmbeddingService` (384-d deterministic legal vectorizer with OpenAI/Gemini upgrade path).
   - Top-K semantic similarity search in vector database filtered by authenticated `userId` (and `documentId`).
   - Cross-clause reranking: evaluates candidate passages using semantic cosine similarity, keyword density / legal terminology weighting, and exact match boost.
   - Relevance thresholding: minimum confidence score threshold (`min_score`, default 0.25).
   - "Insufficient Information" fallback: explicit notification when no retrieved chunk meets the threshold, guarding against hallucinations.
   - Citation generation: every retrieved chunk generates structured citations (`page`, `section`, `clause_type`).

3. **API & System Integration**:
   - FastAPI endpoints:
     - `POST /api/v1/vector/index`: Index document chunks.
     - `POST /api/v1/vector/delete`: Remove document chunks.
     - `POST /api/v1/retrieve`: Semantic retrieval and reranking pipeline.
     - `GET /api/v1/vector/stats`: Health & vector telemetry.
   - Node/Express Backend integration:
     - On contract extraction (`POST /api/contracts/:id/extract`), index chunks into ChromaDB.
     - On contract deletion (`DELETE /api/contracts/:id`), purge corresponding chunks from ChromaDB.
     - Query / ask endpoint (`POST /api/contracts/:id/ask` or retrieval endpoint): allows querying a contract and returns grounded passages with citations and confidence.
   - Frontend UI:
     - Contract Q&A / Semantic Search drawer or modal in Dashboard.
     - Input query, view top cited clauses, similarity and rerank scores, and grounded summary/answer.

4. **Testing & Verification**:
   - Unit and integration tests for ChromaDB vector store, multi-tenant isolation, reranker, and FastAPI endpoints.
   - All tests passing with captured command outputs.
