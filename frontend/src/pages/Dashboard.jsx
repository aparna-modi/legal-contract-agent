import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import ContractDrawer from "../components/ContractDrawer";
import LibrarySearchModal from "../components/LibrarySearchModal";
import {
  ArrowRightIcon,
  CompareIcon,
  FileTextIcon,
  MessageIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from "../components/Icons";

const QUICK_LIBRARY_QUERIES = [
  "Termination notice period",
  "Limitation of liability cap",
  "Governing law and jurisdiction",
  "Payment deadlines and late fees",
  "Intellectual property ownership",
];

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Dashboard() {
  const { token, isAuthenticated } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [vectorStats, setVectorStats] = useState(null);

  const [extractingId, setExtractingId] = useState(null);
  const [banner, setBanner] = useState(null);

  const [activeContract, setActiveContract] = useState(null);
  const [drawerTab, setDrawerTab] = useState("overview");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchModal, setSearchModal] = useState({ open: false, query: "" });

  const fetchWorkspaceData = useCallback(
    async ({ showSpinner = false } = {}) => {
      if (!token) return;
      if (showSpinner) {
        setLoading(true);
        setError(null);
      }

      try {
        const [listData, statsData] = await Promise.all([
          contractsApi.list(token),
          contractsApi.vectorStats(token).catch(() => null),
        ]);
        const docs = listData.contracts || [];
        setContracts(docs);
        setError(null);
        if (statsData) setVectorStats(statsData);

        setActiveContract((prev) =>
          prev ? docs.find((d) => d._id === prev._id) || prev : null
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  const loadWorkspace = useCallback(
    () => fetchWorkspaceData({ showSpinner: true }),
    [fetchWorkspaceData]
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    Promise.all([
      contractsApi.list(token),
      contractsApi.vectorStats(token).catch(() => null),
    ])
      .then(([listData, statsData]) => {
        if (cancelled) return;
        const docs = listData.contracts || [];
        setContracts(docs);
        setError(null);
        if (statsData) setVectorStats(statsData);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const metrics = useMemo(() => {
    const analyzed = contracts.filter((c) => c.status === "completed").length;
    const highRiskClauses = contracts.reduce(
      (sum, c) => sum + (c.riskSummary?.high || 0),
      0
    );
    const vectors =
      vectorStats?.user_vectors !== undefined
        ? vectorStats.user_vectors
        : contracts.reduce((sum, c) => sum + (c.vectorCount || 0), 0);

    return {
      total: contracts.length,
      analyzed,
      highRiskClauses,
      vectors,
    };
  }, [contracts, vectorStats]);

  const visibleContracts = useMemo(() => {
    if (statusFilter === "completed") {
      return contracts.filter((c) => c.status === "completed");
    }
    if (statusFilter === "pending") {
      return contracts.filter((c) => c.status !== "completed");
    }
    return contracts;
  }, [contracts, statusFilter]);

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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await contractsApi.remove(token, deleteTarget._id);
      setContracts((prev) => prev.filter((c) => c._id !== deleteTarget._id));
      if (activeContract?._id === deleteTarget._id) {
        setActiveContract(null);
      }
      setBanner({
        tone: "success",
        text: `Removed "${deleteTarget.title || deleteTarget.fileName}" and purged its indexed vectors.`,
      });
      setDeleteTarget(null);
      contractsApi
        .vectorStats(token)
        .then((stats) => setVectorStats(stats))
        .catch(() => {});
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setDeleting(false);
    }
  };

  const openInspector = (doc, tab = "overview") => {
    setActiveContract(doc);
    setDrawerTab(tab);
  };

  const handleLibrarySearch = (e) => {
    e.preventDefault();
    if (!libraryQuery.trim()) return;
    setSearchModal({ open: true, query: libraryQuery.trim() });
  };

  if (!isAuthenticated) {
    return (
      <section className="landing-hero">
        <div className="hero-content">
          <span className="hero-kicker">Document-Grounded Legal Review</span>
          <h1 className="hero-title">
            Understand every obligation, risk, and exit clause before you sign.
          </h1>
          <p className="hero-subtitle">
            Upload employment agreements, vendor MSAs, NDAs, or leases. Legal Contract Agent
            extracts structured clauses, flags high-risk terms and missing protections, compares
            revisions side by side, and answers questions strictly with page and section citations.
          </p>
          <div className="hero-actions">
            <Link to="/register" className="btn btn-primary btn-lg">
              Create free workspace
              <ArrowRightIcon size={16} />
            </Link>
            <Link to="/login" className="btn btn-secondary btn-lg">
              Sign in
            </Link>
          </div>
        </div>

        <div className="hero-pillars">
          <div className="pillar-card">
            <ShieldAlertIcon size={18} />
            <h3>Clause & Risk Triage</h3>
            <p>
              Automatically classifies 14 legal categories, scores severity, and surfaces missing
              commercial protections.
            </p>
          </div>
          <div className="pillar-card">
            <MessageIcon size={18} />
            <h3>Citation-Backed Q&A</h3>
            <p>
              Every answer cites exact pages and headings—and explicitly refuses to guess when a
              contract is silent.
            </p>
          </div>
          <div className="pillar-card">
            <CompareIcon size={18} />
            <h3>Contract Comparison</h3>
            <p>
              Semantically align two contract versions to spot added, removed, and revised terms
              in seconds.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Contract Workspace</h1>
          <p className="page-description">
            Review extracted clauses, inspect risk profiles, and query agreements with verifiable
            citations.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadWorkspace}
            disabled={loading}
          >
            <RefreshIcon size={15} />
            Refresh
          </button>
          {metrics.analyzed >= 2 && (
            <Link to="/compare" className="btn btn-secondary">
              <CompareIcon size={15} />
              Compare
            </Link>
          )}
          <Link to="/upload" className="btn btn-primary">
            <PlusIcon size={15} />
            Upload Contract
          </Link>
        </div>
      </div>

      {/* KPI summary strip */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Contracts</span>
          <span className="kpi-value">{metrics.total}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Analyzed</span>
          <span className="kpi-value">{metrics.analyzed}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">High-Risk Clauses</span>
          <span className={`kpi-value ${metrics.highRiskClauses > 0 ? "text-danger" : ""}`}>
            {metrics.highRiskClauses}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Indexed Passages</span>
          <span className="kpi-value text-accent">{metrics.vectors}</span>
        </div>
      </div>

      {/* Cross-contract semantic search */}
      <section className="search-strip">
        <form onSubmit={handleLibrarySearch} className="search-strip-form">
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
          <button type="submit" className="btn btn-primary" disabled={!libraryQuery.trim()}>
            Search Library
          </button>
        </form>

        <div className="prompt-chips">
          <span className="chip-prefix">Quick queries</span>
          {QUICK_LIBRARY_QUERIES.map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip-btn"
              onClick={() => {
                setLibraryQuery(chip);
                setSearchModal({ open: true, query: chip });
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {banner && (
        <div className={`alert alert-${banner.tone} alert-dismissible`}>
          <span>{banner.text}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Document table */}
      <section className="surface-card table-section">
        <div className="table-toolbar">
          <div className="segmented-control">
            {[
              { key: "all", label: `All (${contracts.length})` },
              { key: "completed", label: `Analyzed (${metrics.analyzed})` },
              {
                key: "pending",
                label: `Pending (${contracts.length - metrics.analyzed})`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`seg-btn ${statusFilter === tab.key ? "active" : ""}`}
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="mono-caption">Scoped to your account · Multi-tenant isolated</span>
        </div>

        {loading && contracts.length === 0 ? (
          <div className="state-box">
            <div className="spinner" />
            <p>Loading your contracts...</p>
          </div>
        ) : error ? (
          <div className="state-box">
            <p className="text-danger">{error}</p>
            <button type="button" className="btn btn-secondary" onClick={loadWorkspace}>
              Try again
            </button>
          </div>
        ) : visibleContracts.length === 0 ? (
          <div className="empty-box">
            <FileTextIcon size={28} />
            <h3>
              {contracts.length === 0
                ? "No contracts in your workspace yet"
                : "No contracts match this filter"}
            </h3>
            <p>
              {contracts.length === 0
                ? "Upload a PDF, DOCX, or TXT agreement to extract clauses, evaluate risks, and run citation-backed Q&A."
                : "Try switching back to All to see every uploaded contract."}
            </p>
            {contracts.length === 0 && (
              <Link to="/upload" className="btn btn-primary">
                <PlusIcon size={15} />
                Upload your first contract
              </Link>
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
                  const isCompleted = doc.status === "completed";
                  const isWorking = extractingId === doc._id || doc.status === "processing";
                  const risk = doc.riskSummary || { high: 0, medium: 0, low: 0, overallLevel: "low" };

                  return (
                    <tr key={doc._id}>
                      <td>
                        <div className="doc-cell">
                          <span className="mono-tag">{(doc.fileType || "doc").toUpperCase()}</span>
                          <div className="doc-cell-text">
                            <button
                              type="button"
                              className="doc-title-link"
                              onClick={() =>
                                isCompleted ? openInspector(doc, "overview") : handleAnalyze(doc)
                              }
                            >
                              {doc.title || doc.fileName}
                            </button>
                            <span className="doc-submeta">
                              {doc.fileName} · {formatFileSize(doc.fileSize)} ·{" "}
                              {formatDate(doc.createdAt)}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className={`status-dot-pill status-${doc.status || "uploaded"}`}>
                          <span className="dot" />
                          {doc.status === "completed"
                            ? "Analyzed"
                            : doc.status === "processing"
                              ? "Processing"
                              : doc.status === "failed"
                                ? "Failed"
                                : "Uploaded"}
                        </span>
                      </td>

                      <td>
                        {isCompleted ? (
                          <div className="risk-cell">
                            <span className={`risk-pill risk-${risk.overallLevel || "low"}`}>
                              {(risk.overallLevel || "low").toUpperCase()}
                            </span>
                            <span className="mono-caption">
                              {risk.high || 0}H / {risk.medium || 0}M / {risk.low || 0}L
                            </span>
                          </div>
                        ) : (
                          <span className="muted-caption">Not analyzed</span>
                        )}
                      </td>

                      <td>
                        {isCompleted ? (
                          <span className="mono-caption">
                            {doc.pageCount || 1}p · {doc.totalSections || 0} sec ·{" "}
                            {(doc.totalTokens || 0).toLocaleString()} tok
                          </span>
                        ) : (
                          <span className="muted-caption">Ready for parsing</span>
                        )}
                      </td>

                      <td className="col-actions">
                        <div className="row-actions">
                          {isCompleted ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openInspector(doc, "overview")}
                              >
                                Inspect
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => openInspector(doc, "qa")}
                              >
                                <MessageIcon size={14} />
                                Ask
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAnalyze(doc)}
                              disabled={isWorking}
                            >
                              <SparklesIcon size={14} />
                              {isWorking ? "Analyzing..." : "Analyze"}
                            </button>
                          )}

                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            onClick={() => setDeleteTarget(doc)}
                            title="Delete contract"
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

      {activeContract && (
        <ContractDrawer
          key={`${activeContract._id}-${drawerTab}`}
          contract={activeContract}
          initialTab={drawerTab}
          token={token}
          onClose={() => setActiveContract(null)}
        />
      )}

      {searchModal.open && (
        <LibrarySearchModal
          key={searchModal.query}
          initialQuery={searchModal.query}
          token={token}
          onClose={() => setSearchModal({ open: false, query: "" })}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete contract?"
        message={`This permanently removes "${deleteTarget?.title || deleteTarget?.fileName}", all extracted clauses, and its indexed vectors from your account.`}
        confirmLabel="Delete permanently"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
