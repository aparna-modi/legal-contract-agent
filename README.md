# Legal Contract Agent

A full-stack contract review and clause intelligence platform for freelancers, small businesses, HR teams, and legal reviewers. Upload `.pdf` (including scanned PDFs via multimodal OCR), `.docx`, or `.txt` agreements to get plain-English clause explanations, Indian statutory Act & Section references, risk triage, jurisdiction-specific playbook checks, side-by-side redline comparisons, and citation-backed Q&A that refuses to guess when the contract is silent.

For system topology, load-balancing design, and security controls, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Core Features

- **Plain-English Clause Breakdown & Indian Law Context**: Automatically classifies clauses across 14 legal categories, explains each clause in plain English, flags risk severity (`high` / `medium` / `low`) and missing protections, and maps provisions to relevant Indian statutes (Indian Contract Act 1872, Transfer of Property Act 1882, Specific Relief Act 1963, Registration Act 1908, Arbitration & Conciliation Act 1996, RERA 2016, Copyright Act 1957, IT Act 2000 / DPDP Act 2023).
- **Grounded RAG Q&A**: Answers user questions directly in plain language with clickable page/section citations, applicable Indian law references, confidence scoring, reviewer thumbs-up/down feedback, Q&A response caching, and explicit abstention when the document lacks evidence.
- **Interactive Document & Citation Viewer**: Streams original PDFs/contracts with page jump controls and click-to-highlight citation synchronization.
- **Redline Revision Comparison**: Semantically aligns two contract versions to surface added, removed, and modified clauses with inline word-level diffs and numeric/risk-shift notes.
- **Legal Playbooks & Fallback Redlines**: Includes one-click jurisdiction rule packs (US Commercial/SaaS, India Commercial/Contract Act, UK & EU GDPR, Freelancer/Contractor), custom firm rules, compliance scoring, and AI-drafted fallback clause wording.
- **Multi-Tenant Security, Team RBAC & Admin Console**: Short-lived HS256 JWTs, rotating `HttpOnly` refresh token families with replay-theft detection, global session revocation (`tokenVersion`), brute-force lockout, password reset tokens, Organization Team workspaces (`admin`, `counsel`, `reviewer`), cross-account Platform Admin Console (`/admin`), and immutable audit logs.
- **Production Infrastructure**: Pluggable S3/Cloudflare R2/local object storage, ChromaDB/Qdrant vector store, Redis hybrid rate limiting & caching, async extraction queue with SSE progress streaming, round-robin circuit-breaker AI worker pool, Nginx load balancer configs, Prometheus `/metrics`, and GitHub Actions CI.

## Project Structure

```text
legal-contract-agent/
├── frontend/          # React 19 + Vite 8 + React Router v7 SPA
├── backend/           # Node.js + Express 5 + Mongoose 9 API gateway
├── ai-service/        # Python 3.13 + FastAPI extraction, RAG & analysis service
├── infra/nginx/       # Edge load balancer & TLS 1.3 reverse proxy configs
├── scripts/           # Full-stack E2E suite & vector pipeline verifier
├── docker-compose.yml # Multi-replica load-balanced stack (Nginx + 2x API + AI + Redis + Qdrant)
└── render.yaml        # Render Blueprint for AI service + API gateway
```

## Local Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB Atlas URI (or local MongoDB)
- Google Gemini API key (optional; deterministic local fallback runs offline when omitted)

### Install Dependencies

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

### Environment Variables

Copy the templates and fill in your credentials:
- `backend/.env.example` → `backend/.env`
  - Required: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `AI_SERVICE_URL` (or comma-separated `AI_SERVICE_URLS`), `INTERNAL_API_KEY`, `CORS_ORIGINS`
  - Optional (production): `COOKIE_SAMESITE=none`, `REDIS_URL`, `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_*`, `SENTRY_DSN`
- `ai-service/.env.example` → `ai-service/.env`
  - Required: `GEMINI_API_KEY`, `INTERNAL_API_KEY`, `CORS_ORIGINS`
  - Optional (production): `VECTOR_STORE_PROVIDER=qdrant`, `QDRANT_URL`, `QDRANT_API_KEY`

### Run Locally

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- AI Service: `http://localhost:8000`

## Deployment

### Cloud Stack (Vercel + Render + Atlas + Qdrant + R2 + Upstash)
1. **Backend & AI Service (Render)**: Create a **New Blueprint** from this repository using [`render.yaml`](./render.yaml) and provide the `sync: false` secrets (`MONGODB_URI`, `GEMINI_API_KEY`, `INTERNAL_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `S3_*`, `REDIS_URL`, `CORS_ORIGINS`).
2. **Frontend (Vercel)**: Import this repository with **Root Directory** set to `frontend` and add `VITE_API_URL=https://<your-render-backend>.onrender.com`. [`frontend/vercel.json`](./frontend/vercel.json) handles SPA route rewrites automatically.
3. **CORS Wiring**: Set `CORS_ORIGINS=https://<your-app>.vercel.app` on the Render backend service.

### Self-Hosted Docker Compose

```bash
# Default stack (Nginx LB on :5173 -> 2 API replicas + Redis + AI service + ChromaDB)
docker compose up --build

# With external Qdrant vector store
VECTOR_STORE_PROVIDER=qdrant docker compose --profile qdrant up --build
```

## Testing & Evaluation

```bash
# Backend unit tests, AI pytest suite, vector pipeline check, and 95-check E2E suite
npm test

# Formal RAG & risk benchmark (Precision/Recall/MRR, Citation Accuracy, Faithfulness, Latency)
npm run eval:rag
npm run eval:rag:offline

# Frontend lint & production build
npm run frontend:lint
npm run frontend:build
```

### Benchmark Results (`npm run eval:rag` — Live Gemini `gemini-3.5-flash-lite`)
- **Retrieval Recall@3 / MRR**: `100.0%` / `1.000`
- **Citation Accuracy**: `100.0%` *(target ≥ 90%)*
- **Faithfulness & Hallucination Refusal**: `100.0%` (`6/6` grounded, `3/3` out-of-scope refused — *target ≥ 95%*)
- **High-Risk Flag Precision**: `100.0%` *(target ≥ 85%)*
- **Average Q&A Latency**: `~3.0s` *(target < 8.0s)*
