# Legal Contract Agent

Live app: [https://legalcontractagent.duckdns.org](https://legalcontractagent.duckdns.org) (hosted on Vultr Mumbai behind Caddy with automatic HTTPS)

Legal Contract Agent is a contract review, drafting, and dispute-prep workspace built for founders, teams, and legal practitioners. You can upload a PDF (including scanned documents), DOCX, or TXT file, or draft a new agreement from scratch across 12 templates.

Once a document is uploaded, the app breaks it down clause by clause with page references, flags drafting loopholes and missing protections, scores the contract across five legal metrics, and lets you rewrite the agreement strictly in your favor before signing. It also connects contract clauses to Indian civil and criminal statutes (both IPC 1860 and BNS 2023) when preparing for a dispute.

> Note: This tool is built to assist with contract review, drafting, and case preparation. Always have a licensed lawyer review an agreement before signing or filing in court.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design and [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md) for pre-launch checks.

---

## What It Does

### Reviewing Contracts (`/`, `/upload`)
- **Side & role selection:** Pick which party and role you represent (`Client / Buyer`, `Vendor / Seller`, `Employee`, `Employer`, `Tenant`, `Landlord`, `Contractor`, or `Founder / Investor`) during upload or inside the contract view. Risk and protection scores adjust to your side.
- **Live extraction:** Uploaded PDFs, DOCX, and TXT files run through an async pipeline with live progress updates, pulling out section headings, key facts, parties, obligations, and deadlines.
- **Contract inspector:** Every analyzed document opens in a tabbed panel covering Overview, Clauses, Loopholes, Protect My Side, Counsel & Cases, Negotiation, Playbook, Q&A, and the original Source document.

### Loophole Checks & Health Scorecard
- Scores each contract across five axes: Overall Health (A–F grade), Loophole Tightness, User Protection, Enforceability, and Risk Score, along with a projected score after fixes.
- Flags six types of drafting gaps: undefined capitalized terms, unfilled placeholders (`[TBD]`, `____`), unilateral discretion and statutory traps (like post-termination non-competes void under Section 27 of the Indian Contract Act), duties without timelines or remedies, broken cross-references, and missing boilerplate. Each finding includes what could go wrong and drop-in replacement wording.

### Rewriting a Contract for Your Side
- **Protect My Side:** Rewrites an existing vendor or counterparty draft exclusively to protect your side (`Protect Only My Side` or `Firm Negotiable` mode) while keeping clauses enforceable under governing law.
- Shows before/after protection scores, lists each clause changed, lets you save the new version to your workspace to diff against the original, and exports directly to Word (`.docx`).

### Negotiation & Redlining
- Generates a pre-signing brief with deal breakers, walk-away red lines, and trade-off options.
- Drafts clause-level redlines (`Balanced`, `Client-Favorable`, or `Vendor-Favorable`) with Tier-2 compromise fallbacks and inline word diffs, plus one-click drafts for missing clauses.
- Builds a ready-to-send counterparty negotiation email in Collaborative, Firm, or Executive tone.

### Litigation Support & Indian Statutes (IPC / BNS 2023)
- Maps clauses and breach scenarios to Indian civil remedies (Indian Contract Act 1872, Specific Relief Act 1963, CPC Order 37/39, Arbitration & Conciliation Act 1996, Commercial Courts Act Sec. 12A, Transfer of Property Act, RERA, IT Act, and DPDP Act 2023).
- Maps criminal exposure across both IPC (1860) and BNS (2023) along with NI Act Sec. 138, noting the proof required so complaints hold up under BNSS Sec. 528.
- Builds winning arguments tied to contract quotes, an admissibility checklist (BSA 2023 Sec. 63, Stamp Act Sec. 35, Registration Act Sec. 17), a procedural roadmap, opposing-defense rebuttals, voice dictation for breach facts, and a formal Indian Legal Notice draft.

### Cited Q&A & Library Search (`Ctrl+K`)
- Ask questions inside any contract in either **Contract Facts** mode or **Counsel Strategy** mode. Answers cite exact pages and sections and decline cleanly when the document does not cover the question.
- Press `Ctrl+K` anywhere to search across all analyzed contracts in your workspace.

### Drafting, Hardening & Baselines (`/draft`)
- **12 commercial templates:** MSA, Mutual NDA, SaaS Subscription, DPA, Employment, Independent Contractor, Commercial Lease, Property Sale Agreement, Founders Agreement, Software Development, Partnership Deed, and Settlement & Mutual Release.
- Supports `Protect User Only`, `User-Favorable`, and `Balanced` postures, partner annotations, automatic self-audit scoring, and version history with line diffs.
- **Draft hardening:** Scans a rough initial draft and patches loopholes and undefined terms without changing commercial prices, dates, or deal structure.
- **Presentation & firm baselines:** Formats drafts to a 10-point legal presentation checklist (title block, recitals, definitions, hierarchical numbering, schedules, witness blocks), saves reusable firm baselines, and benchmarks uploaded contracts against them.
- **Clause bank:** Save and reuse approved clauses (comes with starter clauses out of the box) and insert them into drafts.

### Compare, Playbooks, Exports & Analytics
- **Compare (`/compare`):** Run a side-by-side redline diff between two uploaded contracts (with risk-shift stats and counter-redlines), or benchmark any contract against a saved firm baseline.
- **Playbooks (`/playbook`):** Supports 9 rule types (required clauses, restricted keywords, notice minimums, governing law, max high-risk count, defined terms, unilateral amendment bans, cure periods, and liability cap limits), built-in packs including India Litigation-Ready, and a rule compiler that turns written company guidelines into checks.
- **Exports:** Download formatted Word (`.docx`) files with Georgia typography, page numbering, schedules, and signature blocks; export obligation deadlines as `.ics` calendar files (per contract or full portfolio); or export Print/PDF and Markdown reports.
- **Analytics & Admin (`/analytics`, `/security`, `/admin`):** Portfolio risk and health charts, team workspaces (`Admin`, `Counsel`, `Reviewer`), active session tracking, Resend emails for password resets and team invites, and an admin console with health telemetry and audit logs.

---

## Tech Stack

| Part | Stack |
| --- | --- |
| Frontend | React 19, Vite 8, React Router v7, Framer Motion |
| Backend | Node.js 20, Express 5, Mongoose 9 (MongoDB Atlas + GridFS / S3), Helmet, Redis |
| AI Service | Python 3.13, FastAPI, Google Gemini (`google-genai`), Qdrant / ChromaDB, `pypdf`, `python-docx` |
| Hosting | Vultr VPS ([`docker-compose.vultr.yml`](./docker-compose.vultr.yml) + Caddy HTTPS), Render ([`render.yaml`](./render.yaml)), Docker Compose |

---

## Local Setup

You will need **Node.js 20+**, **Python 3.11+** (3.13 recommended), a **MongoDB** URI, and optionally a **Google Gemini API key** (offline fallbacks still run without one).

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

Copy the example env files and add your keys (never commit `.env` or `.env.vultr`):

```bash
cp backend/.env.example backend/.env
cp ai-service/.env.example ai-service/.env
```

### Environment Variables

#### Backend (`backend/.env` or `.env.vultr`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | API port |
| `NODE_ENV` | Prod | `development` | Enables HSTS, `/metrics` auth, secure cookies |
| `MONGODB_URI` | Yes | - | MongoDB connection string (wrap in `'...'` inside `.env.vultr` because of `&`) |
| `JWT_SECRET` | Yes | - | Random string, at least 32 chars in prod |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token TTL |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | Refresh session TTL |
| `AI_SERVICE_URL` / `AI_SERVICE_URLS` | Yes | `http://127.0.0.1:8000` | FastAPI worker URL(s) |
| `AI_TIMEOUT_MS` | No | `170000` (prod) | Timeout for long drafts and rewrites |
| `ENABLE_KEEP_ALIVE` | No | `true` (prod) | Keeps DB, AI worker, and frontend warm |
| `KEEP_ALIVE_INTERVAL_MS` | No | `240000` | Keep-alive interval (4 min) |
| `INTERNAL_API_KEY` | Prod | - | Shared secret between backend and AI service |
| `CORS_ORIGINS` | Prod | `https://${APP_DOMAIN}` | Allowed frontend origin(s) |
| `COOKIE_SAMESITE` | Prod | `lax` / `none` | `lax` on Vultr behind Caddy; `none` across separate domains |
| `STORAGE_PROVIDER` | No | `gridfs` | `local`, `gridfs`, or `s3` |
| `PLATFORM_ADMIN_EMAILS` | No | - | Comma-separated admin emails |
| `REDIS_URL` | No | - | Redis URL for shared rate limits and cache |
| `RESEND_API_KEY` | No | - | Resend key for reset and invite emails |
| `EMAIL_FROM` | If Resend | `"Legal Contract Agent <onboarding@resend.dev>"` | Wrap in `"..."` in `.env.vultr`; use a verified domain to email external addresses |
| `SENTRY_DSN` | No | - | Optional Sentry DSN |

#### AI Service (`ai-service/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | No | `8000` | FastAPI port |
| `APP_ENV` | Prod | `development` | Enforces internal key auth and hides `/docs` in prod |
| `GEMINI_API_KEY` | Recommended | - | Google Gemini API key |
| `GEMINI_LLM_MODEL` | No | Auto fallback | Optional model override (`gemini-3.5-flash`, `gemini-2.5-flash`, `gemini-3.5-flash-lite`) |
| `INTERNAL_API_KEY` | Prod | - | Must match backend |
| `VECTOR_STORE_PROVIDER` | No | `chroma` (`qdrant` in prod) | `chroma`, `chroma-http`, or `qdrant` |
| `QDRANT_URL` / `QDRANT_API_KEY` | If `qdrant` | - | Qdrant Cloud URL & key, or `http://qdrant:6333` for local Qdrant |

#### Frontend (`frontend/.env`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_API_URL` | Split domains | `""` (Vultr) / `http://localhost:5000` | Leave blank on Vultr (same-origin `/api/*`); set backend URL on Render/Vercel |

Start all three services locally:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5000`
- AI Service: `http://localhost:8000`

---

## Tests

```bash
npm run backend:test
npm run ai:test
npm run eval:rag:offline
npm run frontend:lint && npm run frontend:build
```

---

## Deployment

### Vultr VPS (Primary: `https://legalcontractagent.duckdns.org`)

Runs Caddy (automatic Let's Encrypt TLS), the static frontend, two load-balanced backend replicas, the private AI service, Redis, and a lightweight 4-minute `lca-keepalive` watchdog container on Ubuntu 24.04 LTS (2 vCPU / 4 GB RAM).

1. **First-time server setup:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/aparna-modi/legal-contract-agent/main/infra/vultr/setup-server.sh | sudo bash
   ```
2. Whitelist your Vultr IPv4 in MongoDB Atlas Network Access and point your domain (or DuckDNS subdomain) to that IP.
3. Fill in `/opt/legal-contract-agent/.env.vultr` using [`.env.vultr.example`](./.env.vultr.example) (keep `MONGODB_URI='...'` and `EMAIL_FROM="..."` quoted).
4. **Deploy and verify:**
   ```bash
   cd /opt/legal-contract-agent && bash infra/vultr/deploy.sh --no-pull
   ```
5. **Deploying later changes:**
   - Manually on the server: `cd /opt/legal-contract-agent && bash infra/vultr/deploy.sh`
   - Automatically from GitHub: add `VULTR_HOST`, `VULTR_USER`, and `VULTR_SSH_KEY` to GitHub repo secrets and uncomment the `push` trigger in [`.github/workflows/deploy-vultr.yml`](./.github/workflows/deploy-vultr.yml).

### Render (Alternative)

1. Create services from [`render.yaml`](./render.yaml) (New -> Blueprint) and fill in the required secrets.
2. Deploy `frontend/` as a Static Site (`npm install && npm run build`, publish `dist`, `VITE_API_URL=https://<backend>.onrender.com`).
3. [`.github/workflows/keep-alive.yml`](./.github/workflows/keep-alive.yml) pings the services every 5 minutes alongside the backend's own 4-minute keep-alive loop.
