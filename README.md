# Legal Contract Agent

Reading through a long agreement page by page is slow, and it is easy to miss a buried auto-renewal date, an uncapped liability clause, or a strict penalty buried on page 19. **Legal Contract Agent** helps individuals, founders, and legal teams review contracts faster without losing track of what the document actually says.

Upload a `.pdf` (including scanned copies), `.docx`, or `.txt` file. The app breaks it down into individual clauses, explains them in plain English, highlights risks and missing protections, lists key dates and obligations, compares two versions side by side, and answers questions with direct links to the exact page and section.

> **Note:** This app is meant to help with first-pass contract review and organization. It is **not legal advice** and does not replace a qualified lawyer.

For technical architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For launch checks, see [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md).

---

## What You Can Do With It

- **Contract Workspace & Side-by-Side Inspector**  
  Keep all your agreements in one searchable workspace with light and dark themes. Open any analyzed contract in a 5-tab panel (**Overview**, **Clauses & Risks**, **Document**, **Ask Contract**, and **Playbook**) to inspect summaries, jump straight to cited pages, and export clean PDF or Markdown reports.
- **Plain-English Clause Breakdown & Risk Highlights**  
  Every clause is categorized, scored (`Low`, `Medium`, `High`), and explained in everyday language—alongside relevant Indian statutory references where applicable, a table of deadlines/obligations, and a list of missing standard protections you can draft in one click.
- **Ask Questions About Your Contract (and Search Everything with `Ctrl+K`)**  
  Ask follow-up questions about payment terms, notice periods, deposits, or exit clauses. Every answer quotes the source passage and links directly to the page. If a contract doesn't mention what you asked about, the app says so clearly instead of guessing.
- **Draft Agreements from Scratch (`/draft`)**  
  Start from 7 built-in templates (**MSA**, **Mutual NDA**, **SaaS**, **DPA**, **Employment**, **Independent Contractor**, and **Commercial Lease**), request edits in plain English, fill bracketed blanks inline, print to PDF or download `.md`, and save straight to your workspace.
- **Compare Two Versions (`/compare`)**  
  Pick any two analyzed agreements to see word-by-word additions and deletions, how overall risk shifted between drafts, and suggested balanced counter-wording for risky changes.
- **Custom Review Playbooks (`/playbook`)**  
  Load a jurisdiction starter pack (India Commercial, US Commercial/SaaS, UK & EU GDPR, Freelancer/Contractor) or paste your own review rules in plain English, then audit contracts against them.
- **Team Sharing, Account Security & Admin Console**  
  Open to both personal users and teams (no corporate email required). Manage your profile, password, active devices, and optional team roles (`Admin`, `Counsel`, `Reviewer`). Admins also get a dedicated console with live service health checks and a paginated cross-account audit log.

---

## Tech Stack

| Part | Built With |
| --- | --- |
| Frontend | React 19, Vite 8, React Router v7, Framer Motion |
| Backend API | Node.js 20, Express 5, Mongoose 9 (MongoDB + GridFS / S3), Helmet, Redis (optional) |
| AI Service | Python 3.13, FastAPI, Google Gemini (`google-genai`), Qdrant / ChromaDB, `pypdf`, `python-docx` |
| Hosting | Render (`render.yaml`), Vercel (`frontend/vercel.json`), Docker Compose |

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

### Common Deployment Notes
- **First load feels slow on Render free tier**: Free services sleep after 15 minutes of inactivity and take ~30–50 seconds to wake up. The backend automatically retries transient `502`/`503`/`504` errors and recovers its health status once the AI worker responds.
- **Session refresh returns `401` across domains**: Make sure `NODE_ENV=production` and `COOKIE_SAMESITE=none` are set on the backend, and `CORS_ORIGINS` matches your exact HTTPS frontend URL without a trailing slash.

---

## Contributing

1. Branch off `main` (`git checkout -b feat/your-change`).
2. Keep commit messages clear and concise.
3. Run `npm run backend:test`, `npm run ai:test`, `npm run frontend:lint`, and `npm run frontend:build` before opening a pull request.
