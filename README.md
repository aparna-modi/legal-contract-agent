# Legal Contract Agent

A full-stack contract review and clause intelligence platform that parses `.pdf`, `.docx`, and `.txt` agreements, classifies legal clauses across 14 categories, flags risk drivers and missing protections, compares contract revisions side by side, and answers questions with page and section citations.

## Architecture

The project runs as three decoupled services:

- **Frontend (`frontend/`, port `5173`)**: React 19 + Vite 8 + React Router v7 workspace with a contract inspection drawer, risk filtering, grounded Q&A, cross-contract search, side-by-side comparison, and Markdown report export.
- **API Gateway (`backend/`, port `5000`)**: Node.js + Express 5 + Mongoose 9 (MongoDB Atlas), Multer file uploads (10 MB limit), bcrypt password hashing, and 7-day JWT authentication with strict per-user ownership enforcement.
- **AI Service (`ai-service/`, port `8000`)**: Python 3.13 + FastAPI + Uvicorn, `pypdf` / `python-docx` / `tiktoken` extraction, ChromaDB persistent HNSW cosine vector index, hybrid legal reranking, and Google Gemini (`google-genai` SDK: `gemini-3.5-flash-lite` via Interactions API + `gemini-embedding-001` with offline deterministic fallback).

## Key Features

- **Multi-tenant security**: Every MongoDB route verifies document ownership (`403` on mismatch), and every ChromaDB query and deletion filters strictly by `user_id`.
- **Layout-aware extraction**: Tracks page numbers, section headings, subclauses, character offsets, token counts (`cl100k_base`), and converts embedded `.docx` tables to Markdown.
- **Clause classification & risk engine**: Classifies clauses into 14 legal categories, scores severity (`high` / `medium` / `low`) with plain-English explanations, and flags missing baseline protections (e.g., absent Termination or Liability Cap clauses).
- **Executive summary & key facts**: Extracts parties, effective date, term/duration, payment terms, notice period, governing law, and primary obligations.
- **Grounded Q&A & hallucination defense**: Combines dense retrieval (`gemini-embedding-001` / local fallback) with `LegalReranker`, prompt-injection-safe `<contract_excerpt>` delimiters, a calibrated confidence threshold, and structured JSON grounding verification so unsupported questions are explicitly refused.
- **Contract-to-contract comparison**: Semantically aligns clauses between two analyzed contracts to identify modified, added, removed, and unchanged provisions with numeric/risk shift highlights.
- **Report export & cascade delete**: One-click Markdown report download (`GET /api/contracts/:id/report`) and cascade deletion across disk, MongoDB, and ChromaDB.

## Project Structure

```text
legal-contract-agent/
├── ai-service/
│   ├── extractors/         # PDF, DOCX, TXT parsers + token chunking helpers
│   ├── services/           # LLM client, embeddings, clause risk engine, analysis, ChromaDB, RAG retrieval
│   ├── tests/              # Pytest unit and API tests
│   ├── main.py             # FastAPI endpoints
│   └── requirements.txt
├── backend/
│   ├── config/db.js        # MongoDB connection
│   ├── middleware/         # JWT protect middleware
│   ├── models/             # User, Document, Clause Mongoose models
│   ├── routes/             # Auth and contract gateway endpoints
│   └── server.js
├── frontend/
│   └── src/
│       ├── api/client.js   # Centralized fetch client
│       ├── components/     # ContractDrawer, LibrarySearchModal, ConfirmDialog, Icons
│       ├── context/        # AuthContext
│       └── pages/          # Dashboard, UploadScreen, Compare, Login, Register
├── scripts/
│   ├── start-all.bat       # Windows batch launcher
│   ├── start-all.ps1       # PowerShell launcher
│   ├── verify_pipeline.py  # Vector store isolation & retrieval check
│   └── test_e2e.js         # Full-stack end-to-end test suite
└── package.json            # Root scripts (concurrently dev + tests)
```

## Setup & Running Locally

### Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB Atlas URI (or local MongoDB)
- Google Gemini API key (optional; falls back cleanly to local deterministic extraction/embeddings when omitted)

### Installation

```bash
# 1. Install root, backend, and frontend dependencies
npm install
npm --prefix backend install
npm --prefix frontend install

# 2. Set up the Python virtual environment
cd ai-service
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r requirements.txt
# macOS / Linux:
# .venv/bin/pip install -r requirements.txt
cd ..
```

### Environment Configuration

Copy the example environment files and fill in your credentials:
- `backend/.env.example` -> `backend/.env` (`PORT`, `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL`)
- `ai-service/.env.example` -> `ai-service/.env` (`GEMINI_API_KEY`)

### Start All Services

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- AI Service Docs: `http://localhost:8000/docs`

### Verification & Tests

```bash
# Run pytest unit/API tests, ChromaDB pipeline check, and full-stack E2E tests
npm test

# Lint and build the frontend bundle
npm run frontend:lint
npm run frontend:build
```
