# Legal Contract Agent

Reading a 10-page agreement line by line takes time, and missing a single forfeiture clause or short notice window can get expensive. **Legal Contract Agent** is a full-stack web app built to make contract review clear, fast, and verifiable.

Upload any contract (`.pdf`, including scanned PDFs via OCR, `.docx`, or `.txt`), and the app breaks it into clauses, explains each one in plain English, maps relevant Indian Acts and Sections, highlights high-risk language and missing protections, lets you compare revisions side by side, checks the agreement against your firm's playbook, and answers any question you ask about the document with clickable page citations.

If you want the deeper system design and security notes, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What You Can Do With It

- **Plain-English Clause Review & Risk Triage**  
  Splits contracts page by page, strips running headers/footers, groups provisions into 14 legal categories, scores overall risk (`0–100`), flags missing standard protections, and explains every clause in simple language alongside applicable Indian statutes (Indian Contract Act 1872, Transfer of Property Act 1882, Specific Relief Act 1963, Registration Act 1908, Arbitration & Conciliation Act 1996, RERA 2016, Income-tax Act Sec. 194-IA, Copyright Act 1957, IT Act 2000 / DPDP Act 2023).

- **Ask Anything About Your Document (Hybrid Full-Context Q&A)**  
  Combines dense semantic search, lexical/synonym matching, and page-tagged full-document context so you can ask anything—parties, payment schedules, flat/parking numbers, witness addresses, Schedule A/B boundaries, penalties, obligations, or follow-up questions—and get clear, cited answers. When the contract genuinely doesn't mention something, the model tells you plainly instead of guessing.
  - **Self-Healing Index**: If an ephemeral worker restarts and loses its local vector index, the backend automatically rebuilds the contract's vectors from MongoDB and answers without interruption.

- **Interactive Document & PDF Viewer**  
  View the original PDF inline (or open it in a new tab) alongside synchronized page-by-page clauses. Clicking any citation in Q&A or the Clauses tab jumps straight to that page and highlights the exact clause. Uploaded files persist reliably in MongoDB GridFS (or S3/Cloudflare R2 when configured).

- **Redline Revision Comparison & AI Fallback Drafting**  
  Compare two contract versions side by side with word-level redline diffs, numeric/risk-shift notes, and one-click AI-drafted fallback clauses for high- and medium-risk terms.

- **Jurisdiction Playbooks**  
  Load built-in rule packs (India Commercial, US Commercial/SaaS, UK & EU GDPR, Freelancer/Contractor) or create custom firm rules and score any contract for compliance.

- **Workspaces, Team RBAC & Analytics**  
  Includes rotating `HttpOnly` refresh tokens with reuse detection, password reset flows, team workspaces (`admin`, `counsel`, `reviewer`) with private/team contract sharing, cross-contract semantic search (`Ctrl+K`), portfolio risk analytics, an Admin Console, and immutable audit logs.

---

## Tech Stack & Folder Layout

```text
legal-contract-agent/
├── frontend/          # React 19, Vite 8, React Router v7
├── backend/           # Node.js, Express 5, Mongoose 9 (MongoDB Atlas + GridFS)
├── ai-service/        # Python 3.13, FastAPI, Gemini SDK, ChromaDB / Qdrant
├── infra/nginx/       # Edge load balancer & TLS reverse proxy configs
├── scripts/           # Full-stack E2E suite & retrieval pipeline verifier
├── docker-compose.yml # Load-balanced multi-container setup
└── render.yaml        # One-click Render blueprint (AI service + API)
```

---

## Getting Started Locally

### Prerequisites
- **Node.js 20+**
- **Python 3.11+**
- **MongoDB** (Atlas URI or local MongoDB)
- **Google Gemini API Key** (optional—if omitted, the app falls back to deterministic local embeddings and extractive summaries so everything still runs offline)

### 1. Install Dependencies

```bash
npm install
npm --prefix backend install
npm --prefix frontend install

cd ai-service
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r requirements.txt
# macOS / Linux:
# .venv/bin/pip install -r requirements.txt
cd ..
```

### 2. Configure Environment Variables

Copy the example files and fill in your credentials:

- **`backend/.env`** (from `backend/.env.example`)
  - Required: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL` (or comma-separated `AI_SERVICE_URLS`), `CORS_ORIGINS`
  - Recommended for production: `INTERNAL_API_KEY`, `COOKIE_SAMESITE=none`, `STORAGE_PROVIDER=gridfs` (persists files in MongoDB with zero extra setup) or `STORAGE_PROVIDER=s3` with `S3_*` keys, optional `REDIS_URL`, `RESEND_API_KEY`, `SENTRY_DSN`
- **`ai-service/.env`** (from `ai-service/.env.example`)
  - Required for live AI: `GEMINI_API_KEY`
  - Recommended for production: `INTERNAL_API_KEY` (must match backend), `CORS_ORIGINS`, optional `VECTOR_STORE_PROVIDER=qdrant` with `QDRANT_URL` & `QDRANT_API_KEY`

### 3. Run Everything Together

```bash
npm run dev
```

- **Frontend:** `http://localhost:5173`
- **Backend API:** `http://localhost:5000`
- **AI Service:** `http://localhost:8000`

---

## Deploying to Production

### Render + Vercel (Recommended Free/Low-Cost Setup)
1. **Backend & AI Service on Render**: Create a **New Blueprint** from this repo using [`render.yaml`](./render.yaml). Add your secrets (`MONGODB_URI`, `GEMINI_API_KEY`, `INTERNAL_API_KEY`, `CORS_ORIGINS`). Files are persisted automatically in MongoDB GridFS and Q&A vectors self-heal on cold starts, so you don't even need paid disks, S3, or Qdrant to run reliably.
2. **Frontend on Vercel**: Import the repo with **Root Directory** set to `frontend` and set `VITE_API_URL=https://<your-render-backend>.onrender.com`. [`frontend/vercel.json`](./frontend/vercel.json) handles SPA routing.
3. **Wire CORS**: Set `CORS_ORIGINS=https://<your-app>.vercel.app` on the Render backend service.

### Self-Hosted Docker Compose

```bash
# Default stack (Nginx LB on :5173 -> 2 API replicas + Redis + AI service + ChromaDB)
docker compose up --build

# Optional: run with external Qdrant vector store
VECTOR_STORE_PROVIDER=qdrant docker compose --profile qdrant up --build
```

---

## Running Tests & Benchmarks

```bash
# Full suite: backend unit tests, AI pytest suite, vector pipeline check, and E2E suite
npm test

# Individual suites
npm run backend:test
npm run ai:test
npm run test:pipeline
npm run test:e2e

# RAG & risk evaluation benchmark (live Gemini or offline deterministic mode)
npm run eval:rag
npm run eval:rag:offline

# Frontend lint & production build
npm run frontend:lint
npm run frontend:build
```

> **Note:** Legal Contract Agent is designed as a fast, citation-grounded first-pass review assistant and does not replace formal advice from a qualified advocate or legal counsel.
