---
milestone: Legal Contract Agent
version: 1.0.0
updated: 2026-10-15
---

# ROADMAP

> **Current Phase:** Phase 5 (Week 5) — Vector Database Integration & Retrieval Pipeline
> **Status:** 🔄 In Progress

---

## 12-Week Roadmap

### Phase 1 (Week 1): Scaffolding & Architecture Setup
- **Status:** ✅ Complete
- **Deliverables:** React, Express, FastAPI scaffolding, environment config, project rules.

### Phase 2 (Week 2): Authentication & MongoDB Core Schemas
- **Status:** ✅ Complete
- **Deliverables:** JWT auth, bcrypt password hashing, User and Document schemas.

### Phase 3 (Week 3): Contract Upload & File Validation
- **Status:** ✅ Complete
- **Deliverables:** Multer storage, PDF/DOCX/TXT validation, 10MB limits, metadata capture.

### Phase 4 (Week 4): Multi-Format Extraction, Chunking & Embeddings
- **Status:** ✅ Complete
- **Deliverables:** PyPDF/docx/txt extractors, legal-aware chunking, character offsets, 384-d deterministic legal embeddings.

### Phase 5 (Week 5): Vector Database Integration & Retrieval Pipeline
- **Status:** ✅ Complete
- **Objective:** ChromaDB integration, multi-tenant vector storage, semantic search, hybrid re-ranking, and grounded evidence retrieval with citation formatting.
- **Plans:**
  - [x] Plan 5.1: Vector Store Adapter & ChromaDB Engine (multi-tenant filtering, batch upsert, delete)
  - [x] Plan 5.2: Retrieval & Hybrid Re-ranking Pipeline (semantic similarity + legal keyword scoring + thresholding)
  - [x] Plan 5.3: FastAPI AI Service Vector Endpoints (`/api/v1/vector/index`, `/api/v1/vector/delete`, `/api/v1/retrieve`, `/api/v1/vector/stats`)
  - [x] Plan 5.4: Express Backend Integration (`/api/contracts/:id/extract` vector indexing, deletion sync, `/api/contracts/:id/ask` endpoint)
  - [x] Plan 5.5: Frontend Semantic Search & Cited Q&A Interface on Dashboard
  - [x] Plan 5.6: Test Suite (vector isolation, retrieval accuracy, API verification) & Viva Guide update

### Phase 6 (Week 6): Automatic Summarisation, Clause Extraction & Classification
- **Status:** ⬜ Not Started

### Phase 7 (Week 7): Risk Detection Engine
- **Status:** ⬜ Not Started

### Phase 8 (Week 8): Grounded Contract Q&A (Full LLM Synthesis)
- **Status:** ⬜ Not Started

### Phase 9 (Week 9): Contract-to-Contract Comparison
- **Status:** ⬜ Not Started

### Phase 10 (Week 10): Dashboard, Risk Visualisation & Downloadable Reports
- **Status:** ⬜ Not Started

### Phase 11 (Week 11): Evaluation & Security Review
- **Status:** ⬜ Not Started

### Phase 12 (Week 12): Docker, Deployment & Final Demonstration
- **Status:** ⬜ Not Started
