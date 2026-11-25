import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import ContractDrawer from "../components/ContractDrawer";
import LibrarySearchModal from "../components/LibrarySearchModal";
import {
  ArrowRightIcon, CompareIcon, FileTextIcon, LockIcon, MessageIcon, PenToolIcon, PlusIcon,
  RefreshIcon, SearchIcon, ServerIcon, ShieldCheckIcon,
  SparklesIcon, TrashIcon, XIcon,
} from "../components/Icons";
import { PageReveal, StaggerContainer, StaggerItem } from "../components/Motion";
import { EASE_EDITORIAL } from "../components/motionTokens";

const QUICK_QUERIES = [
  "Termination notice period",
  "Limitation of liability cap",
  "Governing law and jurisdiction",
  "Payment deadlines and late fees",
  "Intellectual property ownership",
];

const EDITORIAL_PILLARS = [
  {
    num: "01",
    title: "Clause, Risk & Obligation Triage",
    body: "Classifies 14 legal categories, surfaces subtle semantic risks, flags missing protections, and extracts a structured party-by-party deadlines ledger.",
  },
  {
    num: "02",
    title: "Multi-Turn Grounded Q&A",
    body: "Hold follow-up conversations anchored strictly to your document with clickable page citations—and explicit refusal whenever the contract is silent.",
  },
  {
    num: "03",
    title: "Redline Diffs & Firm Playbooks",
    body: "Align contract versions with word-level redlines, evaluate against jurisdiction rule packs, and generate balanced fallback clauses on demand.",
  },
  {
    num: "04",
    title: "AI Contract Drafting Studio",
    body: "Draft clean, section-numbered MSAs, NDAs, employment, contractor, and lease agreements tailored to your terms, then analyze in one click.",
  },
];

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const formatSize = (b) =>
  !b ? "0 KB" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;

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
      setBanner({ tone: "success", text: `Removed "${deleteTarget.title || deleteTarget.fileName}" and purged its vectors.` });
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
      <PageReveal className="landing-hero">
        <section className="hero-split">
          <div className="hero-content">
            <span className="hero-kicker">Document-Grounded Legal Intelligence</span>
            <h1 className="hero-title">Understand every obligation, risk, and exit clause before you sign.</h1>
            <p className="hero-subtitle">
              Upload employment agreements, vendor MSAs, NDAs, or leases—or draft clean commercial agreements from scratch.
              Inspect structured clauses, obligations ledgers, word-level redlines, firm playbook checks, and page-cited Q&amp;A in one editorial workspace.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary btn-lg">Create free workspace <ArrowRightIcon size={16} /></Link>
              <Link to="/login" className="btn btn-secondary btn-lg">Sign in</Link>
            </div>
            <p className="hero-meta-note">
              Supports PDF (with automatic OCR for scans), DOCX, and TXT · Informational review only, not legal advice.
            </p>
          </div>

          <div className="hero-preview-wrap" aria-hidden="true">
            <div className="hero-preview-backsheet" />
            <motion.div
              className="hero-preview-sheet"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: EASE_EDITORIAL }}
            >
              <div className="preview-sheet-top">
                <div>
                  <div className="preview-clause-label">Vendor Revision · PDF · 14 Pages</div>
                  <div className="preview-doc-title">Master Services Agreement</div>
                </div>
                <span className="risk-pill risk-high">HIGH · 74/100</span>
              </div>

              <div className="preview-clause-block">
                <span className="preview-clause-label">Section 7.2 · Limitation of Liability (Page 6)</span>
                <p className="preview-clause-text">
                  Notwithstanding any other provision herein,{" "}
                  <mark className="preview-highlight-risk">
                    Customer&apos;s indemnification obligations and liability for indirect claims shall remain uncapped
                  </mark>{" "}
                  while Vendor&apos;s aggregate liability is limited to one month&apos;s fees.
                </p>
              </div>

              <div className="preview-callout">
                <div className="preview-callout-head">
                  <span>Fallback Redline Suggested</span>
                  <span className="mono-caption">Playbook Rule #3</span>
                </div>
                <p>
                  Cap mutual aggregate liability at fees paid in the preceding 12 months and exclude consequential damages symmetrically for both parties.
                </p>
              </div>

              <div className="preview-sheet-foot">
                <div className="preview-meter-wrap">
                  <div className="section-head-row">
                    <span className="mono-caption">Clause Risk Profile</span>
                    <span className="mono-caption">3H · 4M · 11L</span>
                  </div>
                  <div className="risk-bar">
                    <div className="risk-bar-seg seg-high" style={{ width: "20%" }} />
                    <div className="risk-bar-seg seg-medium" style={{ width: "26%" }} />
                    <div className="risk-bar-seg seg-low" style={{ width: "54%" }} />
                  </div>
                </div>
                <span className="citation-tag">Page 6, §7.2</span>
              </div>
            </motion.div>
          </div>
        </section>

        <StaggerContainer className="editorial-pillars" stagger={0.05}>
          {EDITORIAL_PILLARS.map((item) => (
            <StaggerItem key={item.num} className="editorial-pillar">
              <span className="pillar-num">{item.num}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <div className="trust-strip-card">
          <span className="trust-item"><LockIcon size={15} /> Rotating HttpOnly refresh tokens &amp; RBAC</span>
          <span className="trust-item"><ShieldCheckIcon size={15} /> Multi-tenant MongoDB &amp; vector isolation</span>
          <span className="trust-item"><ServerIcon size={15} /> Prompt-injection guards &amp; circuit-breaker AI pool</span>
        </div>
      </PageReveal>
    );
  }

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Contract Workspace</h1>
          <p className="page-description">Manage agreements, inspect risk profiles and deadlines, draft new contracts, and query clauses with verifiable citations.</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadWorkspace} disabled={loading}>
            <RefreshIcon size={15} /> Refresh
          </button>
          <Link to="/draft" className="btn btn-secondary"><PenToolIcon size={15} /> Draft</Link>
          {metrics.analyzed >= 2 && (
            <Link to="/compare" className="btn btn-secondary"><CompareIcon size={15} /> Compare</Link>
          )}
          <Link to="/upload" className="btn btn-primary"><PlusIcon size={15} /> Upload Contract</Link>
        </div>
      </div>

      <StaggerContainer className="kpi-grid" stagger={0.04}>
        <StaggerItem className="kpi-card"><span className="kpi-label">Total Contracts</span><span className="kpi-value">{metrics.total}</span></StaggerItem>
        <StaggerItem className="kpi-card"><span className="kpi-label">Analyzed</span><span className="kpi-value">{metrics.analyzed}</span></StaggerItem>
        <StaggerItem className="kpi-card"><span className="kpi-label">High-Risk Clauses</span><span className={`kpi-value ${metrics.highRiskClauses ? "text-danger" : ""}`}>{metrics.highRiskClauses}</span></StaggerItem>
        <StaggerItem className="kpi-card"><span className="kpi-label">Indexed Passages</span><span className="kpi-value text-accent">{metrics.vectors}</span></StaggerItem>
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
            <button key={chip} type="button" className="chip-btn" onClick={() => { setLibraryQuery(chip); setSearchModal({ open: true, query: chip }); }}>
              {chip}
            </button>
          ))}
        </div>
      </section>

      {banner && (
        <div className={`alert alert-${banner.tone} alert-dismissible`} role="status">
          <span>{banner.text}</span>
          <button type="button" className="icon-btn" onClick={() => setBanner(null)} aria-label="Dismiss"><XIcon size={14} /></button>
        </div>
      )}

      <section className="surface-card table-section">
        <div className="table-toolbar">
          <div className="toolbar-left-group">
            <div className="segmented-control">
              {[["all", `All (${contracts.length})`], ["completed", `Analyzed (${metrics.analyzed})`], ["pending", `Pending (${contracts.length - metrics.analyzed})`]].map(([key, label]) => (
                <button key={key} type="button" className={`seg-btn ${statusFilter === key ? "active" : ""}`} onClick={() => setStatusFilter(key)}>{label}</button>
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
            <FileTextIcon size={28} />
            <h3>{contracts.length ? "No contracts match this filter" : "No contracts in your workspace yet"}</h3>
            <p>{contracts.length ? "Reset filters to view all uploaded contracts." : "Upload a PDF, DOCX, or TXT contract — or draft one from a template — to extract clauses and run grounded Q&A."}</p>
            {contracts.length ? (
              <button type="button" className="btn btn-secondary" onClick={() => { setStatusFilter("all"); setRiskFilter("all"); setTableSearch(""); }}>Reset filters</button>
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
                <tr><th>Document</th><th>Status</th><th>Risk Profile</th><th>Details</th><th className="col-actions">Actions</th></tr>
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
                            <button type="button" className="doc-title-link" onClick={() => (done ? (setActiveContract(doc), setDrawerTab("overview")) : handleAnalyze(doc))}>
                              {doc.title || doc.fileName}
                            </button>
                            <span className="doc-submeta">
                              {doc.fileName} · {formatSize(doc.fileSize)} · {formatDate(doc.createdAt)}{doc.visibility === "team" ? " · Team" : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`status-dot-pill status-${doc.status || "uploaded"}`}>
                          <span className="dot" />
                          {done ? "Analyzed" : doc.status === "processing" ? "Processing" : doc.status === "queued" ? "Queued" : doc.status === "failed" ? "Failed" : "Uploaded"}
                        </span>
                      </td>
                      <td>
                        {done ? (
                          <div className="risk-cell-stack">
                            <div className="risk-cell">
                              <span className={`risk-pill risk-${r.overallLevel || "low"}`}>{(r.overallLevel || "low").toUpperCase()}</span>
                              <span className="mono-caption">{r.high || 0}H / {r.medium || 0}M / {r.low || 0}L</span>
                            </div>
                            <div className="mini-score-track">
                              <span className={`mini-score-fill seg-${r.overallLevel || "low"}`} style={{ width: `${Math.min(100, Math.max(6, r.score || 0))}%` }} />
                            </div>
                          </div>
                        ) : <span className="muted-caption">Not analyzed</span>}
                      </td>
                      <td>
                        {done ? (
                          <span className="mono-caption">{doc.pageCount || 1}p · {doc.totalSections || 0} sec · {(doc.totalTokens || 0).toLocaleString()} tok</span>
                        ) : <span className="muted-caption">Ready for parsing</span>}
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          {done ? (
                            <>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setActiveContract(doc); setDrawerTab("overview"); }}>Inspect</button>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setActiveContract(doc); setDrawerTab("qa"); }}><MessageIcon size={14} /> Ask</button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAnalyze(doc)} disabled={busy}>
                              <SparklesIcon size={14} /> {busy ? "Analyzing..." : doc.status === "failed" ? "Retry" : "Analyze"}
                            </button>
                          )}
                          <button type="button" className="icon-btn icon-btn-danger" onClick={() => setDeleteTarget(doc)} aria-label={`Delete ${doc.title || doc.fileName}`}>
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
          <LibrarySearchModal key={searchModal.query} initialQuery={searchModal.query} token={token} onClose={() => setSearchModal({ open: false, query: "" })} />
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete contract?"
        message={`Permanently remove "${deleteTarget?.title || deleteTarget?.fileName}", all extracted clauses, and its indexed vectors?`}
        confirmLabel="Delete permanently"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageReveal>
  );
}
