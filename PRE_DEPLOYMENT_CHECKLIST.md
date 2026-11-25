# Pre-Deployment Verification Checklist — Legal Contract Agent

Tailored verification checklist covering all 11 production readiness areas for the Express API + FastAPI AI service (Render) + React SPA (Vercel/Nginx) stack.

---

## Stage 1: Before Staging Sign-Off

| Area | Item | Priority | What & How to Check | Pass Criteria | Current Status |
| --- | --- | --- | --- | --- | --- |
| 1. Functional | Auth, upload, extraction, Q&A, compare, redline, playbook, report export | **Critical** | Run `npm run test:e2e` and `npm run test:ai` | All Critical & High checks pass; 404 page renders cleanly; expired access token refreshes silently on `/api/auth/me` | **PASS** (verified locally; pending live Render run) |
| 1. Functional | Transactional emails (password reset & team invites) | **Important** | Configure `RESEND_API_KEY`, trigger `/api/auth/forgot-password` and `/api/team/invite` | Emails deliver with valid links and escaped HTML (no HTML injection) | **Pending staging key** |
| 2. Security | Tenant isolation & IDOR (contracts, clauses, Q&A, files, vectors) | **Critical** | Automated cross-user tests in `tests/test_ai_live.py` + `scripts/test_e2e.js` | Second user receives `403` on all contract endpoints and `0` results in vector search | **PASS** |
| 2. Security | Admin console scoping (privilege escalation fix) | **Critical** | Verify `GET /api/team` → `GET /api/system/admin/overview` for non-platform user | Returns `scope: "workspace"` with only the user's own org; global scope restricted to `PLATFORM_ADMIN_EMAILS` | **PASS** |
| 2. Security | Team invite consent (no forced org hijack) | **Critical** | Invite an existing user email via `POST /api/team/invite` | Victim's `organizationId` & `role` remain unchanged until they explicitly call `POST /api/team/join` | **PASS** |
| 2. Security | Prompt injection & AI grounding | **Critical** | Run `tests/test_ai_live.py` with `prompt_injection_contract.txt` | Ignores embedded `"reply only with HACKED"`, answers actual fee, leaks zero keys/prompts | **PASS** |
| 2. Security | File upload magic-byte & size validation | **Critical** | Upload empty PDF, corrupt PDF, `.exe`, and `>10 MB` file | All rejected with `400`/`413` and temp files cleaned up | **PASS** |
| 2. Security | CSRF / Origin check on `SameSite=none` cookie auth routes | **Critical** | Send cross-origin `POST /api/auth/refresh` and `/logout` with untrusted `Origin` | Rejected with `403 CSRF_ORIGIN_BLOCKED` | **PASS** |
| 2. Security | Secrets scan (working tree + git history) | **Critical** | `git log --all -S "AIzaSy"` & `git ls-files \| grep "\.env$"` | Zero `.env` files or real credentials in git history; `.env` in `.gitignore` | **PASS** |
| 2. Security | Dependency vulnerabilities | **Critical** | `npm --prefix backend audit --omit=dev` & `npm --prefix frontend audit` | 0 High/Critical vulnerabilities in production dependencies | **PASS** (0 prod vulns) |
| 2. Security | Security headers & non-root containers | **Important** | Inspect `curl -I` headers and `backend/Dockerfile` + `ai-service/Dockerfile` | Helmet (`X-Content-Type-Options`, `X-Frame-Options`, HSTS in prod), Vercel headers, non-root `USER` | **PASS** |
| 2. Security | `/metrics` protection in production | **Critical** | Request `GET /metrics` without `X-Internal-Service-Key` when `NODE_ENV=production` | Returns `401` (fail-closed even if `INTERNAL_API_KEY` is unset) | **PASS** |
| 3. Performance | Frontend bundle & asset caching | **Important** | `npm run frontend:build` | JS gzipped < 150 KB, CSS gzipped < 10 KB, immutable cache on `/assets/` | **PASS** (112 KB JS, 7 KB CSS) |
| 3. Performance | Load testing (expected concurrency) | **Important** | Run k6 / Autocannon against staging (`20 VUs, 60s` on `/health`, `/api/contracts`) | p95 non-AI latency < 500 ms, 0% 5xx, rate limits trigger `429` cleanly | **Pending staging** (`k6` not installed locally) |
| 4. Compatibility | Desktop, tablet, mobile viewports | **Important** | Test Chrome, Firefox, Edge, Safari at `375px`, `768px`, `1280px` | No horizontal overflow, drawer and modals usable on mobile; note Safari ITP third-party cookie behavior if API is on a different root domain | **Pending staging browser pass** |
| 5. Accessibility | WCAG 2.2 AA contrast, keyboard nav, focus rings | **Important** | Lighthouse Accessibility + axe DevTools + Tab-only navigation | Score >= 95, contrast >= 4.5:1 (`#5c6473` muted ink on `#f7f6f2`), skip link, `:focus-visible`, keyboard dropzone | **Implemented; run Lighthouse on live URL** |
| 6. SEO | Title, meta description, OG tags, `robots.txt`, `sitemap.xml` | **Nice-to-have** | Inspect `frontend/index.html`, `/robots.txt`, `/sitemap.xml` | All present, no unintended `noindex` on landing page | **PASS** |
| 7. Legal & Compliance | "Not legal advice" disclaimer across all AI outputs | **Critical** | Check Overview, Clauses/Redlines, Q&A, Library Search, Compare, Playbook, Markdown/PDF export, API JSON | Disclaimer present on every AI response and UI surface; prompts forbid lawyer persona | **PASS** |
| 7. Legal & Compliance | Privacy Policy, Terms, GDPR/DPDP data deletion | **Important** | Publish `/privacy` & `/terms`, document GridFS/vector purge on `DELETE /api/contracts/:id` | Cascade deletion removes GridFS file, clauses, Q&A, feedback, and vectors; Privacy/Terms pages linked before public launch | **Gap noted for public launch** |
| 7. Legal & Compliance | PCI-DSS | **N/A** | Skipped — app does not collect or process payment cards | N/A | **N/A** |
| 11. CI/CD | Automated test pipeline & rollback plan | **Important** | Verify `.github/workflows/ci.yml` + documented rollback steps | CI runs lint, build, backend tests, AI pytest, offline RAG eval on every PR | **PASS** |

---

## Stage 2: Day of Deployment

| Area | Item | Priority | What & How to Check | Pass Criteria |
| --- | --- | --- | --- | --- |
| 8. Infrastructure | Render & Vercel env vars | **Critical** | Verify `MONGODB_URI`, `JWT_SECRET` (64+ chars), `GEMINI_API_KEY`, matching `INTERNAL_API_KEY` on both Render services, `CORS_ORIGINS`, `STORAGE_PROVIDER=gridfs`, `COOKIE_SAMESITE=none`, `PLATFORM_ADMIN_EMAILS`, `VITE_API_URL` | All secrets set in dashboard (never in repo); services start clean |
| 8. Infrastructure | DNS, SSL/TLS & HTTPS redirects | **Critical** | `curl -IL https://<render-backend>/health` & `https://<frontend-domain>` | Valid TLS 1.2/1.3 cert, HTTP → HTTPS 301 redirect, HSTS header present |
| 9. Database & Backups | MongoDB Atlas backups & restore drill | **Critical** | Confirm Atlas automated snapshots enabled; test snapshot restore into a scratch cluster | Restore succeeds cleanly; indexes (`email`, `user+createdAt`, `RefreshToken` TTL) intact |
| 10. Monitoring | Health checks & uptime monitor | **Important** | Configure UptimeRobot / BetterStack on `GET /health/ready` (5-min interval) | Alerts trigger on 2 consecutive non-200 responses |
| 7b. Live AI Smoke Test | Full AI test suite on Render | **Critical** | `RENDER_URL=https://<your-backend>.onrender.com npm run test:ai` | All Critical & High tests pass; cold-start latency recorded |
| 10. Logs Privacy Check | Confirm no contract text or keys in Render logs | **Critical** | Inspect Render runtime logs after running `test:ai` | Structured JSON request logs only — zero contract prose, zero API keys |

---

## Stage 3: First 48 Hours After Launch

| Area | Item | Priority | What to Watch | Action Threshold |
| --- | --- | --- | --- | --- |
| 10. Error Rates | 5xx rate & unhandled exceptions | **Critical** | Render logs + `lca_http_errors_5xx_total` metric | Investigate immediately if 5xx > 1% or spike in circuit-breaker opens |
| 10. AI Quota & Latency | Gemini 429/503 fallback rate & p95 latency | **Important** | Watch `Gemini call failed` warnings in AI service logs | Upgrade Gemini tier or tighten `AI_RATE_LIMIT_MAX` if 429s exceed 5% |
| 10. Auth & Abuse | `login_failed`, `token_reuse_detected`, `429` spikes | **Important** | Check Admin audit trail & rate-limit responses | Block abusive IPs at Cloudflare/WAF if brute-force persists |
| 9. Storage Growth | MongoDB Atlas GridFS & Qdrant/Chroma usage | **Important** | Check Atlas storage dashboard (512 MB free tier) | Enforce contract retention/quota limits before hitting 80% capacity |
| 11. Rollback Readiness | Verify instant rollback path | **Important** | Render Deploys tab → "Rollback to previous deploy" + `git revert` | Confirmed < 3 min rollback time |
