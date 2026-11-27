# Legal Contract Agent

Reading through a long agreement page by page is slow, and it is easy to miss a buried auto-renewal date, an uncapped liability clause, or a strict penalty buried on page 19. **Legal Contract Agent** helps individuals, founders, and legal teams review contracts faster without losing track of what the document actually says.

Upload a `.pdf` (including scanned copies via OCR), `.docx`, or `.txt` file. The workspace extracts every clause with exact page citations, audits drafting loopholes and statutory exposure, scores contract health across five legal axes, rewrites agreements exclusively to protect your side, compares revisions word by word, and supports courtroom strategy under Indian civil and penal law.

> **Counsel Notice:** Built to accelerate contract review, drafting, and litigation preparation. Obtain independent review from qualified legal counsel prior to execution or filing.

For technical architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For launch checks, see [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md).

---

## Core Capabilities

- **Contract Workspace & Multi-Tab Counsel Inspector**  
  Manage agreements in a searchable workspace with light and dark editorial themes. Open any analyzed agreement to inspect executive briefings, 5-axis legal health scorecards, clause risk tiers, loopholes, protective rewrites, IPC/BNS litigation strategy, playbooks, page-cited Q&A, and the source document side by side.
- **Loophole Audit, Corrective Measures & 5-Axis Scorecard**  
  Detects undefined capitalized terms, unassigned commercial placeholders, unilateral escape hatches, toothless obligations, broken cross-references, and statutory traps (including ICA Sec. 27 restraints), with ready-to-insert corrective clauses and a projected health score.
- **Exclusive User-Side Protective Rewriter ("Protect My Side")**  
  Select the party and commercial role you represent to redraft the entire agreement strictly in your favor—neutralizing adverse clauses and inserting role-specific safeguards while preserving enforceability—then save and compare against the original draft.
- **Counsel Litigation Strategy & IPC (1860) ↔ BNS (2023) Linkage**  
  Maps contract breaches to Indian civil/commercial remedies (ICA 1872, SRA 1963, CPC Order 37/39, Arbitration Act Sec. 9/11/21, Commercial Courts Act Sec. 12A) alongside dual IPC/BNS penal tracks, courtroom winning arguments, BSA 2023 Sec. 63 evidence checklists, and a formal Indian Legal Notice generator.
- **Page-Cited Q&A & Library Search (`Ctrl+K`)**  
  Ask factual or strategic questions across a single contract or your entire library. Every finding quotes the source clause and links directly to the page, declining cleanly when the text does not support an answer.
- **Senior Drafting Studio, Initial-Draft Hardening (4a) & Firm Baselines (4b) (`/draft`)**  
  Draft from 12 commercial templates (`MSA`, `Mutual NDA`, `SaaS`, `DPA`, `Employment`, `Contractor`, `Commercial Lease`, `Property Sale`, `Founders`, `Software Dev`, `Partnership`, `Settlement`) with `Protect User Only`, `User-Favorable`, or `Balanced` postures; harden rough drafts surgically without altering deal terms; standardize to a 10-point law-firm presentation baseline; benchmark contracts against saved firm baselines; maintain an Approved Clause Bank; and export formatted Word (`.docx`), Markdown (`.md`), PDF, and Calendar (`.ics`) files.
- **Revision & Firm Baseline Comparison (`/compare`)**  
  Compare two contract revisions word by word with risk-shift metrics and counter-redlines, or benchmark any uploaded contract directly against curated and custom firm baselines.
- **Legal Playbooks & Compliance (`/playbook`)**  
  Apply jurisdictional starter packs (including India Litigation-Ready, India Commercial, US SaaS, UK/EU GDPR, and Contractor) or compile custom policy prose into structured compliance checks.
- **Team Sharing, Account Security & Admin Console**  
  Supports both individual practitioners and legal teams with role-based access (`Admin`, `Counsel`, `Reviewer`), session management, live service telemetry, and a paginated cross-account audit log.

---

## Tech Stack

| Part | Built With |
| --- | --- |
| Frontend | React 19, Vite 8, React Router v7, Framer Motion |
| Backend API | Node.js 20, Express 5, Mongoose 9 (MongoDB + GridFS / S3), Helmet, Redis (optional) |
| AI Service | Python 3.13, FastAPI, Google Gemini (`google-genai`), Qdrant / ChromaDB, `pypdf`, `python-docx` |
| Hosting | Render (`render.yaml`), Vultr VPS (`docker-compose.vultr.yml` + Caddy HTTPS), Docker Compose |

---

## Running Locally

### What You Need
- **Node.js 20+**
- **Python 3.11+** (3.13 recommended)
- **MongoDB** (MongoDB Atlas or a local MongoDB instance)
- **Google Gemini API Key** *(optional — local fallback analysis still runs without one)*

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/aparna-modi/legal-contract-agent.git
cd legal-contract-agent

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

### 2. Set Up Environment Variables

Copy the template files and fill in your values (never commit `.env` files):

```bash
cp backend/.env.example backend/.env
cp ai-service/.env.example ai-service/.env
```

#### Backend (`backend/.env`)

| Variable | Required | Default | What It Does |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | Backend server port |
| `NODE_ENV` | Prod | `development` | Enables production security headers, strict `/metrics` auth, and secure cookies |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `JWT_SECRET` | **Yes** | — | Random secret (at least 32 characters in production) |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | Signed-in session lifetime |
| `AI_SERVICE_URL` | **Yes** | `http://127.0.0.1:8000` | AI service URL (or comma-separated `AI_SERVICE_URLS`) |
| `AI_HEALTH_TIMEOUT_MS` | No | `12000` | Health probe timeout (helpful for free-tier cold starts) |
| `INTERNAL_API_KEY` | Prod | — | Shared secret between backend and AI service |
| `CORS_ORIGINS` | Prod | `http://localhost:5173` | Allowed frontend origins (comma-separated) |
| `COOKIE_SAMESITE` | Prod | `none` (prod) / `lax` | Use `none` when frontend and API are on different domains |
| `STORAGE_PROVIDER` | No | `local` (`gridfs` in prod) | `local`, `gridfs`, or `s3` |
| `PLATFORM_ADMIN_EMAILS` | No | — | Emails allowed full platform-wide admin view |
| `REDIS_URL` | No | — | Optional Redis URL for rate limiting and caching |
| `RESEND_API_KEY` | No | — | Optional Resend API key for reset and invite emails |
| `SENTRY_DSN` | No | — | Optional error reporting DSN |

#### AI Service (`ai-service/.env`)

| Variable | Required | Default | What It Does |
| --- | --- | --- | --- |
| `PORT` | No | `8000` | FastAPI server port |
| `APP_ENV` | Prod | `development` | Set to `production` to enforce internal auth and disable `/docs` |
| `GEMINI_API_KEY` | Recommended | — | Gemini key for summaries, Q&A, OCR, redlines, and drafting |
| `GEMINI_LLM_MODEL` | No | `gemini-3.1-flash-lite` | Optional Gemini model override |
| `INTERNAL_API_KEY` | Prod | — | Must match `backend/.env` |
| `VECTOR_STORE_PROVIDER` | No | `chroma` | `chroma`, `chroma-http`, or `qdrant` |
| `QDRANT_URL` / `QDRANT_API_KEY` | If `qdrant` | — | Qdrant Cloud URL and API key |

#### Frontend (`frontend/.env`)

| Variable | Required | Default | What It Does |
| --- | --- | --- | --- |
| `VITE_API_URL` | Prod | `http://localhost:5000` | Public backend API URL |

### 3. Start All Three Services

```bash
npm run dev
```

- **Frontend:** `http://localhost:5173`
- **Backend API:** `http://localhost:5000`
- **AI Service:** `http://localhost:8000`

---

## Running Tests

All test contracts in `tests/fixtures/` are synthetic (no real client data) and cover risky agreements, 32-page PDFs, scanned PDFs, DOCX tables, revision pairs, prompt-injection attempts, and non-contract files.

```bash
# Backend security, storage, and circuit-breaker tests
npm run backend:test

# AI service unit & API tests
npm run ai:test

# Offline RAG & risk accuracy benchmark
npm run eval:rag:offline

# Frontend lint & production build
npm run frontend:lint && npm run frontend:build

# End-to-end live AI suite (starts local stack automatically if RENDER_URL isn't set)
npm run test:ai
```

To test against a deployed Render backend:

```powershell
$env:RENDER_URL="https://<your-backend-service>.onrender.com"
npm run test:ai
```

---

## Deployment

### Render (Backend + AI Service + Static Frontend)
1. Deploy the backend and AI service using [`render.yaml`](./render.yaml) (**New → Blueprint**).
2. Add your secrets in Render (`MONGODB_URI`, `GEMINI_API_KEY`, matching `INTERNAL_API_KEY` on both services, `CORS_ORIGINS`, and optional Qdrant / S3 / Redis variables).
3. For the frontend (either as a Render Static Site or on Vercel using [`frontend/vercel.json`](./frontend/vercel.json)):
   - Root directory: `frontend`
   - Build command: `npm install && npm run build`
   - Publish directory: `dist`
   - Environment variable: `VITE_API_URL=https://<your-backend-service>.onrender.com`

### Vultr Production VPS (Docker Compose + Caddy HTTPS + 24/7 Keep-Alive)
1. Copy `.env.vultr.example` to `.env.vultr` and populate your domain, MongoDB, Gemini, and internal keys.
2. Launch the full stack (2 load-balanced backend replicas, AI service, Qdrant, Redis, Caddy automatic TLS, and the 4-minute `keepalive` watchdog):
   ```bash
   docker compose -f docker-compose.vultr.yml --env-file .env.vultr up -d --build
   ```

### Common Deployment Notes
- **Always-Active Keep-Alive**: On Render free tier, the backend's 4-minute self-pulse (`ENABLE_KEEP_ALIVE=true`, `KEEP_ALIVE_INTERVAL_MS=240000`) plus `.github/workflows/keep-alive.yml` (every 5 minutes) keep Frontend, Backend, and AI Service warm continuously. On Vultr, the dedicated `lca-keepalive` container monitors all services locally 24/7.
- **Session refresh returns `401` across domains**: Make sure `NODE_ENV=production` and `COOKIE_SAMESITE=none` are set on the backend, and `CORS_ORIGINS` matches your exact HTTPS frontend URL without a trailing slash.

---

## Contributing

1. Branch off `main` (`git checkout -b feat/your-change`).
2. Keep commit messages clear and concise.
3. Run `npm run backend:test`, `npm run ai:test`, `npm run frontend:lint`, and `npm run frontend:build` before opening a pull request.
