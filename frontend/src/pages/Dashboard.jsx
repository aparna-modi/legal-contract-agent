import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import ContractDrawer from "../components/ContractDrawer";
import LibrarySearchModal from "../components/LibrarySearchModal";
import {
  ArrowRightIcon, CompareIcon, FileTextIcon, MessageIcon, PenToolIcon, PlusIcon,
  RefreshIcon, ScaleIcon, SearchIcon, ShieldAlertIcon, TrashIcon, XIcon,
} from "../components/Icons";
import { AnimatedNumber, FadePanel, PageReveal, StaggerContainer, StaggerItem } from "../components/Motion";
import { SPRING_SNAPPY } from "../components/motionTokens";

const QUICK_QUERIES = [
  "Termination notice period",
  "Limitation of liability cap",
  "Governing law and jurisdiction",
  "Payment deadlines and late fees",
  "Intellectual property ownership",
];

const LANDING_CAPABILITIES = [
  {
    icon: ShieldAlertIcon,
    title: "Clause, Loophole & Risk Audit",
    body: "Scores every contract across five legal axes, uncovers hidden loopholes and missing protections, and maps exposure under Indian civil and penal statutes.",
  },
  {
    icon: MessageIcon,
    title: "Page-Cited Q&A & Counsel Strategy",
    body: "Interrogate any agreement with exact page citations, dual IPC/BNS remedy analysis, and evidence checklists built for dispute readiness.",
  },
  {
    icon: CompareIcon,
    title: "Senior Drafting, Baselines & Redlines",
    body: "Draft from 12 commercial templates, harden initial drafts without altering deal terms, rewrite agreements exclusively for your side, and export .docx files.",
  },
];

const SHOWCASE_TABS = [
  { id: "risk", label: "Risk Triage" },
  { id: "redline", label: "Redline Studio" },
  { id: "qa", label: "Grounded Q&A" },
];

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const formatSize = (b) =>
  !b ? "0 KB" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;

function LandingShowcase() {
  const [activeView, setActiveView] = useState("risk");

  return (
    <div className="desk-frame" aria-label="Interactive contract review preview">
      <div className="desk-frame-bar">
        <div className="desk-doc-id">
          <span className="mono-tag">PDF</span>
          <span className="desk-doc-name">Master Services Agreement — Northstar.pdf</span>
        </div>
        <div className="desk-tab-group" role="tablist" aria-label="Preview modes">
          {SHOWCASE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeView === t.id}
              className={`desk-tab ${activeView === t.id ? "active" : ""}`}
              onClick={() => setActiveView(t.id)}
            >
              <span>{t.label}</span>
              {activeView === t.id && (
                <motion.span layoutId="landing-desk-tab" className="desk-tab-bg" transition={SPRING_SNAPPY} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="desk-frame-body">
        <AnimatePresence mode="wait">
          {activeView === "risk" && (
            <FadePanel panelKey="risk" className="desk-panel">
              <div className="desk-panel-head">
                <div>
                  <span className="desk-eyebrow">Section 7.2 · Limitation of Liability</span>
                  <div className="desk-clause-heading">Asymmetric uncapped indemnity detected</div>
                </div>
                <span className="risk-pill risk-high">HIGH · 74/100</span>
              </div>

              <p className="desk-excerpt">
                Notwithstanding any other provision herein,{" "}
                <mark className="desk-mark-risk">
                  Customer&apos;s indemnification obligations and liability for indirect claims shall remain uncapped
                </mark>{" "}
                while Provider&apos;s aggregate liability is limited to one (1) month&apos;s fees.
              </p>

              <div className="desk-meta-strip">
                <div>
                  <span className="desk-eyebrow">Negotiation Verdict</span>
                  <p className="desk-meta-val">Negotiate before signing — 2 high-risk clauses &amp; 1 missing protection</p>
                </div>
                <span className="citation-tag">Page 6 · §7.2</span>
              </div>

              <div className="desk-bar-wrap">
                <div className="section-head-row">
                  <span className="mono-caption">Risk Profile</span>
                  <span className="mono-caption">2 High · 4 Medium · 12 Low</span>
                </div>
                <div className="risk-bar">
                  <div className="risk-bar-seg seg-high" style={{ width: "16%" }} />
                  <div className="risk-bar-seg seg-medium" style={{ width: "28%" }} />
                  <div className="risk-bar-seg seg-low" style={{ width: "56%" }} />
                </div>
              </div>
            </FadePanel>
          )}

          {activeView === "redline" && (
            <FadePanel panelKey="redline" className="desk-panel">
              <div className="desk-panel-head">
                <div>
                  <span className="desk-eyebrow">Balanced Fallback Redline · Playbook Rule #3</span>
                  <div className="desk-clause-heading">Mutual 12-month fee cap proposed</div>
                </div>
                <span className="risk-pill risk-low">BALANCED</span>
              </div>

              <div className="desk-diff-box">
                <p className="redline-prose">
                  Except for confidentiality breaches or willful misconduct,{" "}
                  <del className="diff-del">Customer&apos;s liability shall remain uncapped while Provider is limited to one month&apos;s fees</del>{" "}
                  <ins className="diff-add">neither party&apos;s aggregate liability shall exceed fees paid during the preceding twelve (12) months</ins>
                  , and neither party shall be liable for indirect or consequential damages.
                </p>
              </div>

              <div className="desk-meta-strip">
                <div>
                  <span className="desk-eyebrow">Tier-2 Compromise Ready</span>
                  <p className="desk-meta-val">2× annual fees super-cap reserved solely for third-party IP claims.</p>
                </div>
                <span className="mono-caption">Indian Contract Act · §74</span>
              </div>
            </FadePanel>
          )}

          {activeView === "qa" && (
            <FadePanel panelKey="qa" className="desk-panel">
              <div className="desk-qa-question">What notice is required to prevent automatic renewal?</div>
              <div className="desk-qa-answer">
                <div className="section-head-row">
                  <span className="desk-verified-label">
                    <span className="verified-dot" /> Verified from contract
                  </span>
                  <span className="confidence-pill conf-high">HIGH CONFIDENCE</span>
                </div>
                <p className="desk-excerpt">
                  Either party must send written non-renewal notice at least <strong>90 days</strong> before the
                  end of the 24-month Initial Term; otherwise the agreement renews automatically for successive
                  12-month terms with up to a 15% fee increase.
                </p>
                <div className="citation-row">
                  <span className="citation-tag">Page 3, Section 4.1 · Term &amp; Auto-Renewal</span>
                  <span className="citation-tag">Page 4, Section 4.2 · Fee Escalation</span>
                </div>
              </div>
            </FadePanel>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { token, isAuthenticated } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [tableSearch, setTableSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [vectorStats, setVectorStats] = useState(null);

  const [extractingId, setExtractingId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [activeContract, setActiveContract] = useState(null);
  const [drawerTab, setDrawerTab] = useState("overview");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchModal, setSearchModal] = useState({ open: false, query: "" });

  const loadWorkspace = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [listData, statsData] = await Promise.all([
        contractsApi.list(token),
        contractsApi.vectorStats(token).catch(() => null),
      ]);
      const docs = listData.contracts || [];
      setContracts(docs);
      setError(null);
      if (statsData) setVectorStats(statsData);
      setActiveContract((prev) => (prev ? docs.find((d) => d._id === prev._id) || prev : null));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([contractsApi.list(token), contractsApi.vectorStats(token).catch(() => null)])
      .then(([listData, statsData]) => {
        if (cancelled) return;
        setContracts(listData.contracts || []);
        if (statsData) setVectorStats(statsData);
        setError(null);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const metrics = useMemo(() => {
    const analyzed = contracts.filter((c) => c.status === "completed").length;
    const highRiskClauses = contracts.reduce((sum, c) => sum + (c.riskSummary?.high || 0), 0);
    const vectors =
      vectorStats?.user_vectors ?? contracts.reduce((sum, c) => sum + (c.vectorCount || 0), 0);
    return { total: contracts.length, analyzed, highRiskClauses, vectors };
  }, [contracts, vectorStats]);

  const visibleContracts = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const list = contracts.filter((c) => {
      if (statusFilter === "completed" && c.status !== "completed") return false;
      if (statusFilter === "pending" && c.status === "completed") return false;
      if (riskFilter !== "all" && (c.status !== "completed" || (c.riskSummary?.overallLevel || "low") !== riskFilter)) {
        return false;
      }
      return !q || `${c.title || ""} ${c.fileName || ""}`.toLowerCase().includes(q);
    });
    if (sortBy === "risk") return list.sort((a, b) => (b.riskSummary?.score || -1) - (a.riskSummary?.score || -1));
    if (sortBy === "title") return list.sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName));
    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [contracts, statusFilter, riskFilter, tableSearch, sortBy]);

  const handleAnalyze = async (doc) => {
    setExtractingId(doc._id);
    setBanner(null);
    try {
      const data = await contractsApi.extract(token, doc._id);
      setBanner({
        tone: "success",
        text: `Analyzed "${doc.title || doc.fileName}" — ${data.savedClausesCount || 0} clauses classified and ${data.vectorsIndexedCount || 0} passages indexed.`,
      });
      loadWorkspace();
      if (data.document) {
        setActiveContract(data.document);
        setDrawerTab("overview");
      }
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setExtractingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contractsApi.remove(token, deleteTarget._id);
      setContracts((prev) => prev.filter((c) => c._id !== deleteTarget._id));
      if (activeContract?._id === deleteTarget._id) setActiveContract(null);
      setBanner({ tone: "success", text: `Deleted "${deleteTarget.title || deleteTarget.fileName}".` });
      setDeleteTarget(null);
      contractsApi.vectorStats(token).then(setVectorStats).catch(() => {});
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setDeleting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <PageReveal className="landing-page">
        <section className="hero-editorial">
          <div className="hero-content">
            <span className="hero-eyebrow">Commercial Contract &amp; Litigation Suite</span>
            <h1 className="hero-title">Audit every clause, close every loophole, and sign on your terms.</h1>
            <p className="hero-subtitle">
              Upload vendor agreements, leases, employment offers, or NDAs—or draft execution-ready contracts from scratch.
              Rewrite terms strictly to protect your side, audit drafting vulnerabilities, compare revisions word by word, and verify every answer against exact page citations.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary btn-lg">
                Get started free <ArrowRightIcon size={15} />
              </Link>
              <Link to="/login" className="btn btn-secondary btn-lg">Sign in</Link>
            </div>
            <p className="hero-meta-note">
              Works with PDF (including scanned copies), DOCX, and TXT · Private to your account
            </p>
          </div>

          <LandingShowcase />
        </section>

        <StaggerContainer className="capability-grid" stagger={0.06}>
          {LANDING_CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <StaggerItem key={item.title} className="surface-card capability-card">
                <span className="capability-icon"><Icon size={17} /></span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </PageReveal>
    );
  }

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Contract Workspace</h1>
          <p className="page-description">
            Review clauses, check key deadlines and risks, draft new agreements, and search across your saved files.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadWorkspace} disabled={loading}>
            <RefreshIcon size={15} /> Refresh
          </button>
          <Link to="/draft" className="btn btn-secondary"><PenToolIcon size={15} /> Drafting</Link>
          {metrics.analyzed >= 2 && (
            <Link to="/compare" className="btn btn-secondary"><CompareIcon size={15} /> Compare</Link>
          )}
          <Link to="/upload" className="btn btn-primary"><PlusIcon size={15} /> Upload Contract</Link>
        </div>
      </div>

      <StaggerContainer className="kpi-grid" stagger={0.04}>
        <StaggerItem
          className={`kpi-card kpi-interactive ${statusFilter === "all" && riskFilter === "all" ? "kpi-active" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => { setStatusFilter("all"); setRiskFilter("all"); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStatusFilter("all"); setRiskFilter("all"); } }}
        >
          <span className="kpi-label">Contracts</span>
          <span className="kpi-value"><AnimatedNumber value={metrics.total} /></span>
          <span className="kpi-sub">All workspace documents</span>
        </StaggerItem>
        <StaggerItem
          className={`kpi-card kpi-interactive ${statusFilter === "completed" && riskFilter === "all" ? "kpi-active" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => { setStatusFilter("completed"); setRiskFilter("all"); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStatusFilter("completed"); setRiskFilter("all"); } }}
        >
          <span className="kpi-label">Analyzed</span>
          <span className="kpi-value"><AnimatedNumber value={metrics.analyzed} /></span>
          <span className="kpi-sub">Clauses &amp; risks extracted</span>
        </StaggerItem>
        <StaggerItem
          className={`kpi-card kpi-interactive ${riskFilter === "high" ? "kpi-active" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => { setStatusFilter("completed"); setRiskFilter((r) => (r === "high" ? "all" : "high")); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStatusFilter("completed"); setRiskFilter((r) => (r === "high" ? "all" : "high")); } }}
        >
          <span className="kpi-label">High-Risk Clauses</span>
          <span className={`kpi-value ${metrics.highRiskClauses ? "text-danger" : ""}`}>
            <AnimatedNumber value={metrics.highRiskClauses} />
          </span>
          <span className="kpi-sub">{riskFilter === "high" ? "Showing high-risk docs" : "Click to filter high-risk"}</span>
        </StaggerItem>
        <StaggerItem className="kpi-card">
          <span className="kpi-label">Searchable Passages</span>
          <span className="kpi-value"><AnimatedNumber value={metrics.vectors} /></span>
          <span className="kpi-sub">Ready for instant Q&amp;A</span>
        </StaggerItem>
      </StaggerContainer>

      <section className="search-strip">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (libraryQuery.trim()) setSearchModal({ open: true, query: libraryQuery.trim() });
          }}
          className="search-strip-form"
        >
          <div className="input-with-icon">
            <SearchIcon size={16} />
            <input
              type="text"
              className="text-input"
              placeholder="Search across all analyzed contracts (e.g., 'What is the termination notice period?')"
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!libraryQuery.trim()}>Search Library</button>
        </form>

        <div className="prompt-chips">
          <span className="chip-prefix">Quick queries</span>
          {QUICK_QUERIES.map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip-btn"
              onClick={() => { setLibraryQuery(chip); setSearchModal({ open: true, query: chip }); }}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`alert alert-${banner.tone} alert-dismissible`}
            role="status"
          >
            <span>{banner.text}</span>
            <button type="button" className="icon-btn" onClick={() => setBanner(null)} aria-label="Dismiss">
              <XIcon size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="surface-card table-section">
        <div className="table-toolbar">
          <div className="toolbar-left-group">
            <div className="segmented-control">
              {[
                ["all", `All (${contracts.length})`],
                ["completed", `Analyzed (${metrics.analyzed})`],
                ["pending", `Pending (${contracts.length - metrics.analyzed})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`seg-btn ${statusFilter === key ? "active" : ""}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="toolbar-filters">
              <select className="select-compact" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} aria-label="Filter by risk">
                <option value="all">All Risk Levels</option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
              </select>
              <select className="select-compact" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort contracts">
                <option value="newest">Sort: Newest</option>
                <option value="risk">Sort: Highest Risk</option>
                <option value="title">Sort: Title A–Z</option>
              </select>
            </div>
          </div>

          <div className="inline-search toolbar-search">
            <SearchIcon size={14} />
            <input type="text" value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Filter documents..." />
          </div>
        </div>

        {loading && !contracts.length ? (
          <div className="skeleton-list">
            {[1, 2, 3].map((r) => (
              <div key={r} className="skeleton-row">
                <div className="skeleton-block sk-title" /><div className="skeleton-block" /><div className="skeleton-block" /><div className="skeleton-block sk-btn" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="state-box">
            <p className="text-danger">{error}</p>
            <button type="button" className="btn btn-secondary" onClick={loadWorkspace}>Retry</button>
          </div>
        ) : !visibleContracts.length ? (
          <div className="empty-box">
            <FileTextIcon size={26} />
            <h3>{contracts.length ? "No contracts match this filter" : "No contracts in your workspace yet"}</h3>
            <p>
              {contracts.length
                ? "Reset active filters to inspect all uploaded contracts."
                : "Upload a PDF, DOCX, or TXT contract—or draft one from a template—to extract clauses, score risks, and ask cited questions."}
            </p>
            {contracts.length ? (
              <button type="button" className="btn btn-secondary" onClick={() => { setStatusFilter("all"); setRiskFilter("all"); setTableSearch(""); }}>
                Reset filters
              </button>
            ) : (
              <div className="hero-actions">
                <Link to="/upload" className="btn btn-primary"><PlusIcon size={15} /> Upload Contract</Link>
                <Link to="/draft" className="btn btn-secondary"><PenToolIcon size={15} /> Draft New Contract</Link>
              </div>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="contracts-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Risk Profile</th>
                  <th>Details</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleContracts.map((doc) => {
                  const done = doc.status === "completed";
                  const busy = extractingId === doc._id || doc.status === "processing" || doc.status === "queued";
                  const r = doc.riskSummary || { high: 0, medium: 0, low: 0, overallLevel: "low", score: 0 };

                  return (
                    <tr key={doc._id}>
                      <td>
                        <div className="doc-cell">
                          <span className="mono-tag">{(doc.fileType || "doc").toUpperCase()}</span>
                          <div className="doc-cell-text">
                            <button
                              type="button"
                              className="doc-title-link"
                              onClick={() => (done ? (setActiveContract(doc), setDrawerTab("overview")) : handleAnalyze(doc))}
                            >
                              {doc.title || doc.fileName}
                            </button>
                            <span className="doc-submeta">
                              {doc.fileName} · {formatSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                              {doc.visibility === "team" ? " · Team" : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`status-dot-pill status-${doc.status || "uploaded"}`}>
                          <span className="dot" />
                          {done
                            ? "Analyzed"
                            : doc.status === "processing"
                              ? "Processing"
                              : doc.status === "queued"
                                ? "Queued"
                                : doc.status === "failed"
                                  ? "Failed"
                                  : "Uploaded"}
                        </span>
                      </td>
                      <td>
                        {done ? (
                          <div className="risk-cell-stack">
                            <div className="risk-cell">
                              <span className={`risk-pill risk-${r.overallLevel || "low"}`}>{(r.overallLevel || "low").toUpperCase()}</span>
                              {doc.scorecard?.grade && (
                                <span className="badge-grade" title={`Contract Health: ${doc.scorecard.overallHealth ?? 0}/100`}>
                                  Grade {doc.scorecard.grade}
                                </span>
                              )}
                              <span className="mono-caption">{r.high || 0}H / {r.medium || 0}M / {r.low || 0}L</span>
                            </div>
                            <div className="mini-score-track">
                              <span
                                className={`mini-score-fill seg-${r.overallLevel || "low"}`}
                                style={{ width: `${Math.min(100, Math.max(6, r.score || 0))}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="muted-caption">Not analyzed</span>
                        )}
                      </td>
                      <td>
                        {done ? (
                          <span className="mono-caption">
                            {doc.pageCount || 1} {doc.pageCount === 1 ? "page" : "pages"} · {doc.totalSections || 0} sections
                          </span>
                        ) : (
                          <span className="muted-caption">Ready to analyze</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          {done ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => { setActiveContract(doc); setDrawerTab("overview"); }}
                              >
                                Inspect
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => { setActiveContract(doc); setDrawerTab("loopholes"); }}
                                title="Inspect Drafting Loopholes & Resolutions"
                              >
                                <ShieldAlertIcon size={14} /> Loopholes
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => { setActiveContract(doc); setDrawerTab("qa"); }}
                              >
                                <MessageIcon size={14} /> Ask
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAnalyze(doc)}
                              disabled={busy}
                            >
                              <ScaleIcon size={14} /> {busy ? "Analyzing..." : doc.status === "failed" ? "Retry" : "Analyze"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            onClick={() => setDeleteTarget(doc)}
                            aria-label={`Delete ${doc.title || doc.fileName}`}
                          >
                            <TrashIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnimatePresence>
        {activeContract && (
          <ContractDrawer
            key={`${activeContract._id}-${drawerTab}`}
            contract={activeContract}
            initialTab={drawerTab}
            token={token}
            onClose={() => setActiveContract(null)}
            onContractUpdated={(updatedDoc) => {
              setActiveContract(updatedDoc);
              setContracts((prev) => prev.map((c) => (c._id === updatedDoc._id ? updatedDoc : c)));
              contractsApi.vectorStats(token).then(setVectorStats).catch(() => {});
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {searchModal.open && (
          <LibrarySearchModal
            key={searchModal.query}
            initialQuery={searchModal.query}
            token={token}
            onClose={() => setSearchModal({ open: false, query: "" })}
          />
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete contract?"
        message={`Permanently delete "${deleteTarget?.title || deleteTarget?.fileName}" and its saved analysis?`}
        confirmLabel="Delete permanently"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageReveal>
  );
}
