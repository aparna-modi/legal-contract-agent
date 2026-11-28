# Legal Contract Agent

**Live Production App:** [https://legalcontractagent.duckdns.org](https://legalcontractagent.duckdns.org) *(Vultr Mumbai · TLS 1.3 via Caddy + Let's Encrypt · Always-Active 24/7 Stack)*

Reviewing long commercial agreements clause by clause is slow, and buried auto-renewal traps, undefined terms, uncapped indemnities, or void statutory restraints are easy to miss before execution. **Legal Contract Agent** gives founders, individuals, commercial teams, and advocates a full senior-counsel workspace—from initial review and loophole hardening to protective redrafting, IPC/BNS litigation strategy, firm baseline benchmarking, and law-firm `.docx` drafting.

Upload a `.pdf` (including scanned copies via OCR), `.docx`, or `.txt` contract—or draft one from scratch across 12 templates. Every clause is extracted with exact page citations, scored across five legal axes, audited for hidden loopholes, mapped to applicable Indian civil and penal statutes, and indexed for citation-backed Q&A.

> **Counsel Notice:** Designed to accelerate contract review, negotiation preparation, drafting, and dispute analysis. Obtain independent review from licensed legal counsel prior to execution or filing.

For system topology and scaling details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For production checks, see [PRE_DEPLOYMENT_CHECKLIST.md](./PRE_DEPLOYMENT_CHECKLIST.md).

---

## Core Capabilities

### 1. Contract Review, Perspective Scoring & 9-Tab Counsel Inspector (`/`)
- **Represented Party & Role Perspective:** Select the exact party and commercial role you represent (`Client / Buyer`, `Vendor / Seller`, `Employee`, `Employer`, `Tenant`, `Landlord`, `Independent Contractor`, or `Founder / Investor`) either on upload (`/upload`) or live inside the contract drawer to recalibrate protection scores from your side.
- **Live Async Extraction Pipeline:** Large and scanned PDFs stream real-time extraction stages (`extracting → analyzing → classifying → completed`) with accurate hierarchical section headings, structured Key Facts, inline PDF/document preview, and Obligations & Deadlines tables.
- **9-Tab Contract Drawer:** Inspect **Overview**, **Clauses**, **Loopholes**, **Protect My Side**, **Counsel & Cases**, **Negotiation**, **Playbook**, **Q&A**, and **Source** side by side in light or dark editorial themes.

### 2. 6-Class Loophole Audit, Corrective Measures & 5-Axis Legal Scorecard
- **5-Axis Legal Health Scorecard:** Evaluates every agreement across **Overall Health (Grade A–F)**, **Loophole Tightness**, **User Protection**, **Enforceability Readiness**, and **Risk Score**, plus a projected health score after applying fixes.
- **6-Class Loophole Engine:** Flags undefined capitalized terms, unassigned commercial placeholders (`[TBD]`, `____`), unilateral escape hatches & statutory traps (such as void post-termination non-competes under Indian Contract Act Sec. 27), toothless obligations without deadlines/remedies, broken cross-references & notice conflicts, and silent boilerplate gaps—each paired with an adversarial exposure scenario and ready-to-insert corrective wording.

### 3. Exclusive User-Side Protective Rewriter ("Protect My Side")
- **Make Present Contract User-Only:** Redrafts an entire counterparty-biased or balanced contract exclusively in your favor (`Protect Only My Side` or `Firm Negotiable` modes), flipping one-sided liabilities, payment triggers, IP ownership, auto-renewals, and termination terms while maintaining statutory enforceability under governing law.
- **Before/After Telemetry & Diff Integration:** Shows protection-score uplift, clause-by-clause transformations, inserted safeguards, and lets you save the protected redraft into your workspace for instant side-by-side comparison against the original or direct `.docx` export.

### 4. Pre-Signing Negotiation Desk & Redline Studio
- **Negotiation Brief:** Generates an executive verdict, counterparty posture, top deal breakers, walk-away red lines, and trade-off strategies.
- **Clause Redlines & Missing Clause Drafter:** Propose `Balanced`, `Client-Favorable`, or `Vendor-Favorable` alternative wording with Tier-2 fallback compromises and inline word diffs, or draft missing standard protections in one click and save approved clauses directly to your Clause Bank.
- **Counterparty Negotiation Email:** Compiles priority issues and accepted redlines into a ready-to-send pre-signing email in **Collaborative**, **Firm**, or **Executive** tone.

### 5. Counsel Litigation Strategy & Dual IPC (1860) ↔ BNS (2023) Linkage
- **Civil & Commercial Remedies:** Anchors dispute scenarios in the Indian Contract Act (1872), Specific Relief Act (1963), CPC (1908, Order 37/39), Arbitration & Conciliation Act (1996, Sec. 9/11/21), Commercial Courts Act (2015, Sec. 12A), Transfer of Property Act, RERA, IT Act (2000), and DPDP Act (2023).
- **Dual Criminal / Penal Tracks (IPC ↔ BNS 2023):** Maps dishonest inducement, criminal breach of trust, cheque dishonour (NI Act Sec. 138), forgery, and unauthorized data disclosure across IPC 1860 and BNS 2023 with explicit proof-of-intent requirements so counsel avoids complaints vulnerable to quashing under BNSS Sec. 528.
- **Courtroom Preparation & Legal Notice Drafter:** Generates winning arguments with exact contract citations, an evidentiary & admissibility checklist (**BSA 2023 Sec. 63**, **Indian Stamp Act Sec. 35**, **Registration Act Sec. 17**), step-by-step procedural roadmaps, anticipated opposing defenses with rebuttals, voice dictation, and a **Formal Indian Legal Notice** ready for `.docx` export.

### 6. Dual-Mode Cited Q&A & Cross-Contract Library Search (`Ctrl+K`)
- **Contract Facts vs. Counsel Strategy Modes:** Switch between strict factual verification and adversarial litigation/negotiation guidance—every answer cites exact pages/sections and refuses honestly when a detail is absent from the contract.
- **Library Semantic Search (`Ctrl+K`):** Query obligations, notice windows, indemnity caps, or governing law across every analyzed contract in your workspace.

### 7. Senior Drafting Studio, Initial-Draft Hardening (4a) & Firm Baselines (4b) (`/draft`)
- **12 Commercial Templates:** `Master Services Agreement (MSA)`, `Mutual NDA`, `SaaS Subscription`, `Data Processing Addendum (DPA)`, `Employment Agreement`, `Independent Contractor`, `Commercial Lease`, `Immovable Property Sale Agreement`, `Founders Agreement`, `Software Development`, `Partnership Deed`, and `Settlement & Mutual Release`—each with dynamic deal fields, `Protect User Only` / `User-Favorable` / `Balanced` stances, Partner Counsel Annotations, Pass-2 Self-Audit scoring, and in-session version history with line diffs.
- **Section 4(a) — Initial Draft Vulnerabilities & Surgical Hardening:** Audits rough drafts and seals loopholes, ambiguities, and undefined terminologies **without altering commercial prices, timelines, or deal structure**.
- **Section 4(b) — Presentation & Firm Baselines:** Standardizes manuscripts to a 10-point law-firm presentation baseline (Title Block, Recitals, Definitions, hierarchical numbering, Boilerplate, Schedules, and 2-Witness execution blocks), saves custom Firm Baselines alongside curated standards, and benchmarks uploaded contracts for structural conformity.
- **Approved Clause Bank:** Manage reusable firm-vetted clauses (curated starters + custom CRUD) and insert them directly into active drafts.

### 8. Revision & Baseline Comparison (`/compare`), Legal Playbooks (`/playbook`) & Analytics (`/analytics`)
- **Two Comparison Modes:** Compare **Two Uploaded Contracts** word/sentence-by-word with net risk shifts and counter-redlines, or benchmark a **Contract vs. Firm Baseline** for section coverage and presentation conformity.
- **Playbooks & Policy Compiler:** Run 9 enforceable rule types (`require_clause`, `forbidden_keyword`, `min_notice_days`, `allowed_jurisdiction`, `max_high_risk`, `require_defined_term`, `forbid_unilateral_amendment`, `require_cure_period_days`, `max_liability_cap_months`), load jurisdictional packs (including **India Litigation-Ready**), or compile natural-prose company guidelines into structured compliance rules.
- **Publication Exports & Portfolio Analytics:** Export formatted **Word (`.docx`)** manuscripts (Georgia typography, headers, Page X of Y footers, Schedule & Signature tables), **Calendar Deadlines (`.ics`)** for single contracts or the entire portfolio, Print/PDF, and clean **Markdown (`.md`)** reports. Track average contract health, loophole tightness, user-side protection, and recurring gaps on `/analytics`.
- **Team Workspaces, Account Security & Admin Console:** Individual and organization workspaces (`Admin`, `Counsel`, `Reviewer`), JWT + rotating refresh cookies, active device/session revocation, transactional Forgot-Password & Team-Invite emails via Resend, and an Admin telemetry & audit console.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 19, Vite 8, React Router v7, Framer Motion |
| **Backend API** | Node.js 20, Express 5, Mongoose 9 (MongoDB Atlas + GridFS / S3), Helmet, Redis (`ioredis`) |
| **AI & Legal Engine** | Python 3.13, FastAPI, Google Gemini (`google-genai` — `gemini-3.5-flash` / `gemini-2.5-flash` failover + `gemini-embedding-001`), Qdrant / ChromaDB, `pypdf`, `python-docx` |
| **Edge & Production Hosting** | Vultr VPS ([`docker-compose.vultr.yml`](./docker-compose.vultr.yml) + Caddy 2.8 automatic TLS 1.3 + 2× API replicas + 24/7 `lca-keepalive` watchdog), Render ([`render.yaml`](./render.yaml)), Docker Compose |

---

## Running Locally

### Prerequisites
- **Node.js 20+**
- **Python 3.11+** (3.13 recommended)
- **MongoDB** (MongoDB Atlas or local MongoDB)
- **Google Gemini API Key** *(optional — deterministic local fallbacks still operate offline)*

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

### 2. Configure Environment Variables

Copy the example templates (never commit `.env` or `.env.vultr` files):

```bash
cp backend/.env.example backend/.env
cp ai-service/.env.example ai-service/.env
```

#### Backend (`backend/.env` / `.env.vultr`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | Backend API port |
| `NODE_ENV` | Prod | `development` | Enables HSTS, strict `/metrics` auth, secure cookies |
| `MONGODB_URI` | **Yes** | — | MongoDB Atlas connection string *(wrap in `'...'` in `.env.vultr` so `&` is preserved)* |
| `JWT_SECRET` | **Yes** | — | Random secret (min 32 characters in production) |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | Signed-in session lifetime |
| `AI_SERVICE_URL` / `AI_SERVICE_URLS` | **Yes** | `http://127.0.0.1:8000` | AI service endpoint(s) (comma-separated for pooling) |
| `AI_TIMEOUT_MS` | No | `170000` (prod) | Upstream AI request timeout for long drafts & rewrites |
| `ENABLE_KEEP_ALIVE` | No | `true` (prod) | Enables backend self-pulse for DB, AI service, and frontend |
| `KEEP_ALIVE_INTERVAL_MS` | No | `240000` | 4-minute keep-alive interval |
| `INTERNAL_API_KEY` | Prod | — | Shared secret between backend and AI service |
| `CORS_ORIGINS` | Prod | `https://${APP_DOMAIN}` | Allowed frontend origin(s) (comma-separated) |
| `COOKIE_SAMESITE` | Prod | `lax` (same-origin) / `none` | Use `lax` on Vultr behind Caddy; `none` when frontend & API use different domains |
| `STORAGE_PROVIDER` | No | `gridfs` (prod) | `local`, `gridfs`, or `s3` (Cloudflare R2 / Vultr Object Storage) |
| `PLATFORM_ADMIN_EMAILS` | No | — | Comma-separated emails granted Admin Console access |
| `REDIS_URL` | No | — | Shared Redis URL for distributed rate limiting & caching |
| `RESEND_API_KEY` | No | — | Resend API key for password reset & team invite emails |
| `EMAIL_FROM` | If Resend | `"Legal Contract Agent <onboarding@resend.dev>"` | Sender header *(quote in `.env.vultr`; use verified custom domain for arbitrary recipients)* |
| `SENTRY_DSN` | No | — | Optional Sentry error reporting DSN |

#### AI Service (`ai-service/.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `8000` | FastAPI port |
| `APP_ENV` | Prod | `development` | Enforces internal auth header & disables public `/docs` in production |
| `GEMINI_API_KEY` | Recommended | — | Google Gemini API key |
| `GEMINI_LLM_MODEL` | No | Auto fallback chain | Optional override (`gemini-3.5-flash` → `gemini-2.5-flash` → `gemini-3.5-flash-lite`) |
| `INTERNAL_API_KEY` | Prod | — | Must match backend `INTERNAL_API_KEY` |
| `VECTOR_STORE_PROVIDER` | No | `chroma` (`qdrant` in prod) | `chroma`, `chroma-http`, or `qdrant` |
| `QDRANT_URL` / `QDRANT_API_KEY` | If `qdrant` | — | Qdrant Cloud URL & key (or `http://qdrant:6333` for self-hosted Qdrant) |

#### Frontend (`frontend/.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | Prod (split domains) | `""` (Vultr) / `http://localhost:5000` | Leave empty on Vultr (same-origin `/api/*` via Caddy); set backend URL on Render/Vercel |

### 3. Start Locally

```bash
npm run dev
```

- **Frontend:** `http://localhost:5173`
- **Backend API:** `http://localhost:5000`
- **AI Service:** `http://localhost:8000`

---

## Running Tests

```bash
# Backend unit tests (security, storage, circuit breaker, job queue)
npm run backend:test

# AI service pytest suite (69 tests covering v3 counsel engine, loopholes, hardening, baselines & DOCX)
npm run ai:test

# Offline RAG & risk accuracy benchmark (100% Recall@3, 100% citation & faithfulness)
npm run eval:rag:offline

# Frontend ESLint & production Vite build
npm run frontend:lint && npm run frontend:build
```

---

## Deployment

### Vultr Production VPS (Current Primary — `https://legalcontractagent.duckdns.org`)

The entire stack (Caddy 2.8 automatic TLS 1.3 + `frontend` + `backend-1` & `backend-2` + private `ai-service` + `redis` + 24/7 `lca-keepalive` watchdog) deploys on a single Ubuntu 24.04 LTS Vultr VPS (2 vCPU / 4 GB RAM recommended):

1. **One-time server bootstrap** (installs Docker, 2 GB swap, UFW firewall on ports 22/80/443, clones `main` into `/opt/legal-contract-agent`, and prepares `.env.vultr`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/aparna-modi/legal-contract-agent/main/infra/vultr/setup-server.sh | sudo bash
   ```
2. **Whitelist the Vultr IPv4** in MongoDB Atlas → Network Access, and point your domain (custom domain `A` record or free DuckDNS subdomain like `legalcontractagent.duckdns.org`) to the Vultr IPv4.
3. **Populate `/opt/legal-contract-agent/.env.vultr`** (see [`.env.vultr.example`](./.env.vultr.example); keep `MONGODB_URI='...'` and `EMAIL_FROM="..."` quoted).
4. **Build, deploy & auto-verify:**
   ```bash
   cd /opt/legal-contract-agent && bash infra/vultr/deploy.sh --no-pull
   ```
5. **Deploying future updates to Vultr:**
   - **Manual 1-command redeploy:** `cd /opt/legal-contract-agent && bash infra/vultr/deploy.sh`
   - **Automatic deploy on `git push` (optional):** Add `VULTR_HOST`, `VULTR_USER`, and `VULTR_SSH_KEY` to GitHub Repository Secrets and uncomment the `push: branches: [main]` trigger in [`.github/workflows/deploy-vultr.yml`](./.github/workflows/deploy-vultr.yml).

### Render Blueprint (Alternative Cloud Deploy)
1. Deploy backend + AI service via [`render.yaml`](./render.yaml) (**New → Blueprint**).
2. Configure secrets (`MONGODB_URI`, `GEMINI_API_KEY`, matching `INTERNAL_API_KEY`, `CORS_ORIGINS`, `QDRANT_URL`, `QDRANT_API_KEY`).
3. Deploy `frontend/` as a Render Static Site (`npm install && npm run build`, publish `dist`, `VITE_API_URL=https://<backend>.onrender.com`).
4. Keep-alive is maintained by the backend's 4-minute self-pulse (`ENABLE_KEEP_ALIVE=true`, `KEEP_ALIVE_INTERVAL_MS=240000`) plus [`.github/workflows/keep-alive.yml`](./.github/workflows/keep-alive.yml) every 5 minutes.

---

## Contributing

1. Branch off `main` (`git checkout -b feat/your-change`).
2. Keep commit messages clear and concise.
3. Run `npm run backend:test`, `npm run ai:test`, `npm run eval:rag:offline`, `npm run frontend:lint`, and `npm run frontend:build` before opening a pull request.
