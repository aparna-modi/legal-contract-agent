import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

const Dashboard = () => {
  const { token, isAuthenticated } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [extractingId, setExtractingId] = useState(null);
  const [extractMessage, setExtractMessage] = useState(null);
  const [vectorStats, setVectorStats] = useState(null);

  // Clauses View Modal
  const [clausesModal, setClausesModal] = useState({
    open: false,
    title: "",
    clauses: [],
    loading: false,
    error: null,
  });

  // Grounded Q&A / Semantic Search Modal
  const [qaModal, setQaModal] = useState({
    open: false,
    contract: null, // null means whole library search
    query: "",
    loading: false,
    error: null,
    response: null,
  });

  // Top library search query
  const [libraryQuery, setLibraryQuery] = useState("");

  const fetchVectorStats = useCallback(() => {
    if (!token) return;
    fetch("http://localhost:5000/api/contracts/stats/vectors", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setVectorStats(data);
      })
      .catch(() => {});
  }, [token]);

  const fetchContracts = useCallback(() => {
    if (!token) return;

    setLoading(true);
    setError(null);
    fetch("http://localhost:5000/api/contracts", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch contracts");
        return res.json();
      })
      .then((data) => {
        setContracts(data.contracts || []);
      })
      .catch((err) => {
        console.error("Error loading contracts:", err);
        setError(err.message || "Failed to load contracts");
      })
      .finally(() => {
        setLoading(false);
      });

    fetchVectorStats();
  }, [token, fetchVectorStats]);

  useEffect(() => {
    if (!token) return;
    fetchContracts();
  }, [token, fetchContracts]);

  const handleExtract = async (contractId, e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      setExtractingId(contractId);
      setExtractMessage(null);
      const res = await fetch(`http://localhost:5000/api/contracts/${contractId}/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Extraction failed");
      }

      setExtractMessage({
        type: "success",
        text: `Extracted ${data.savedClausesCount || 0} clauses & indexed vectors into ChromaDB for "${data.document?.title || "contract"}"!`,
      });
      fetchContracts();
    } catch (err) {
      console.error("Extraction error:", err);
      setExtractMessage({ type: "error", text: err.message || "Failed to extract contract" });
    } finally {
      setExtractingId(null);
    }
  };

  const handleViewClauses = async (contract, e) => {
    e.preventDefault();
    e.stopPropagation();

    setClausesModal({
      open: true,
      title: contract.title || contract.fileName,
      clauses: [],
      loading: true,
      error: null,
    });

    try {
      const res = await fetch(`http://localhost:5000/api/contracts/${contract._id}/clauses`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load clauses");

      setClausesModal({
        open: true,
        title: contract.title || contract.fileName,
        clauses: data.clauses || [],
        loading: false,
        error: null,
      });
    } catch (err) {
      setClausesModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Failed to load clauses",
      }));
    }
  };

  const handleOpenQa = (contract, defaultQuery = "") => {
    setQaModal({
      open: true,
      contract,
      query: defaultQuery,
      loading: false,
      error: null,
      response: null,
    });
    if (defaultQuery) {
      executeQaQuery(contract, defaultQuery);
    }
  };

  const executeQaQuery = async (contract, queryToRun) => {
    const q = (queryToRun || qaModal.query || "").trim();
    if (!q) return;

    setQaModal((prev) => ({ ...prev, loading: true, error: null, query: q }));

    try {
      const url = contract
        ? `http://localhost:5000/api/contracts/${contract._id}/ask`
        : `http://localhost:5000/api/contracts/search`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q, top_k: 5, min_score: 0.20 }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Retrieval failed");
      }

      setQaModal((prev) => ({
        ...prev,
        loading: false,
        response: data,
      }));
    } catch (err) {
      setQaModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Failed to retrieve evidence",
      }));
    }
  };

  const handleTopSearchSubmit = (e) => {
    e.preventDefault();
    if (!libraryQuery.trim()) return;
    handleOpenQa(null, libraryQuery.trim());
  };

  const handleDelete = async (contractId, e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.confirm("Are you sure you want to delete this contract and purge its vector index?")) {
      return;
    }

    try {
      setDeletingId(contractId);
      const res = await fetch(`http://localhost:5000/api/contracts/${contractId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to delete contract");
      }

      setContracts((prev) => prev.filter((c) => c._id !== contractId));
      fetchVectorStats();
    } catch (err) {
      alert(err.message || "Could not delete contract");
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 KB";
    const k = 1024;
    if (bytes < k) return `${bytes} B`;
    if (bytes < k * k) return `${(bytes / k).toFixed(1)} KB`;
    return `${(bytes / (k * k)).toFixed(2)} MB`;
  };

  const renderStatusBadge = (status, vectorIndexed) => {
    const statusMap = {
      uploaded: { label: "Uploaded", class: "badge-uploaded", icon: "📥" },
      processing: { label: "Processing", class: "badge-processing", icon: "⚙️" },
      completed: { label: "Analyzed", class: "badge-completed", icon: "✅" },
      failed: { label: "Failed", class: "badge-failed", icon: "⚠️" },
    };

    const config = statusMap[status] || {
      label: status || "Uploaded",
      class: "badge-uploaded",
      icon: "📄",
    };

    return (
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span className={`status-badge ${config.class}`}>
          <span className="badge-icon">{config.icon}</span>
          {config.label}
        </span>
        {vectorIndexed && (
          <span
            className="status-badge"
            style={{
              background: "rgba(6, 182, 212, 0.15)",
              color: "#38bdf8",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              fontSize: "0.72rem",
            }}
            title="Vectorized and Indexed in ChromaDB"
          >
            🧠 Indexed
          </span>
        )}
      </div>
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="card auth-prompt-card">
        <div className="auth-prompt-content">
          <span className="prompt-icon">🔒</span>
          <h2>Authentication Required</h2>
          <p>Sign in to upload, analyze, and manage your legal contracts securely.</p>
          <div className="auth-prompt-actions">
            <Link to="/login" className="btn btn-primary">
              Log In
            </Link>
            <Link to="/register" className="btn btn-secondary">
              Create Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Contract Repository</h1>
          <p className="page-subtitle">
            Manage your agreements, vector indexes, and grounded legal Q&A
          </p>
        </div>
        <div className="dashboard-actions">
          <button
            onClick={fetchContracts}
            className="btn btn-icon"
            title="Refresh contracts"
            disabled={loading}
          >
            🔄 Refresh
          </button>
          <Link to="/upload" className="btn btn-primary">
            + Upload New Contract
          </Link>
        </div>
      </div>

      {/* Metrics Bar with Week 5 Vector Telemetry */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-title">Total Contracts</span>
          <span className="metric-value">{contracts.length}</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Analyzed & Extracted</span>
          <span className="metric-value">
            {contracts.filter((c) => c.status === "completed").length}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-title">ChromaDB Vectors</span>
          <span className="metric-value" style={{ color: "#38bdf8" }}>
            {vectorStats?.user_vectors !== undefined
              ? vectorStats.user_vectors
              : contracts.reduce((acc, c) => acc + (c.vectorCount || 0), 0)}
          </span>
        </div>
      </div>

      {/* Week 5 Semantic Search Across Contracts */}
      <div className="qa-search-bar-container">
        <form onSubmit={handleTopSearchSubmit} className="qa-search-form">
          <div className="qa-search-input-wrapper">
            <span className="qa-search-icon">🔍</span>
            <input
              type="text"
              className="qa-search-input"
              placeholder="Search across all contracts (e.g. 'What are the termination conditions?')..."
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: "12px 20px" }}>
            Semantic Search
          </button>
        </form>

        <div className="qa-quick-chips">
          <span className="qa-chip-label">Quick Queries:</span>
          {[
            "Termination notice period",
            "Limitation of liability cap",
            "Governing law & dispute jurisdiction",
            "Payment terms and late fees",
            "Intellectual property ownership",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              className="qa-chip"
              onClick={() => {
                setLibraryQuery(chip);
                handleOpenQa(null, chip);
              }}
            >
              ⚡ {chip}
            </button>
          ))}
        </div>
      </div>

      {extractMessage && (
        <div className={`toast-alert toast-${extractMessage.type}`} style={{ marginBottom: "20px" }}>
          <span>{extractMessage.type === "success" ? "✅" : "⚠️"}</span>
          <span>{extractMessage.text}</span>
          <button
            onClick={() => setExtractMessage(null)}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {loading && contracts.length === 0 ? (
        <div className="card loading-card">
          <div className="spinner"></div>
          <p>Retrieving contracts from secure vault...</p>
        </div>
      ) : error ? (
        <div className="card error-card">
          <p className="error-text">⚠️ {error}</p>
          <button onClick={fetchContracts} className="btn btn-secondary">
            Retry
          </button>
        </div>
      ) : contracts.length === 0 ? (
        <div className="card empty-state-card">
          <div className="empty-icon">📁</div>
          <h3>No contracts uploaded yet</h3>
          <p>
            Upload your employment, vendor, lease, or freelance agreement to
            begin clause-level AI risk analysis and vector search.
          </p>
          <Link to="/upload" className="btn btn-primary">
            Upload Your First Contract
          </Link>
        </div>
      ) : (
        <div className="contracts-grid">
          {contracts.map((doc) => (
            <div key={doc._id} className="contract-card">
              <div className="contract-card-header">
                <div className="file-type-pill">
                  {(doc.fileType || "doc").toUpperCase()}
                </div>
                {renderStatusBadge(doc.status, doc.vectorIndexed)}
              </div>

              <div className="contract-card-body">
                <h3 className="contract-title" title={doc.title}>
                  {doc.title || doc.fileName}
                </h3>
                <p className="contract-filename" title={doc.fileName}>
                  📄 {doc.fileName}
                </p>

                <div className="contract-metadata">
                  <div className="meta-item">
                    <span className="meta-label">Size:</span>
                    <span className="meta-val">{formatFileSize(doc.fileSize)}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Uploaded:</span>
                    <span className="meta-val">{formatDate(doc.createdAt)}</span>
                  </div>
                  {doc.status === "completed" && (
                    <>
                      <div className="meta-item">
                        <span className="meta-label">Tokens:</span>
                        <span className="meta-val">{(doc.totalTokens || 0).toLocaleString()}</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Sections:</span>
                        <span className="meta-val">{doc.totalSections || 0}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="contract-card-footer">
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  {doc.status === "uploaded" && (
                    <button
                      onClick={(e) => handleExtract(doc._id, e)}
                      disabled={extractingId === doc._id}
                      className="btn-extract"
                      title="Extract, Chunk, and Index into ChromaDB"
                    >
                      {extractingId === doc._id ? "⚡ Parsing..." : "⚡ Extract & Vectorize"}
                    </button>
                  )}
                  {doc.status === "completed" && (
                    <>
                      <button
                        onClick={(e) => handleViewClauses(doc, e)}
                        className="btn-view-clauses"
                        title="View Extracted Legal Clauses"
                      >
                        📜 Clauses
                      </button>
                      <button
                        onClick={() => handleOpenQa(doc)}
                        className="btn-qa"
                        title="Ask Questions and Retrieve Grounded Citations"
                      >
                        🤖 Ask AI
                      </button>
                    </>
                  )}
                </div>
                <button
                  onClick={(e) => handleDelete(doc._id, e)}
                  disabled={deletingId === doc._id}
                  className="btn-delete"
                  title="Delete Contract & Purge Vectors"
                >
                  {deletingId === doc._id ? "..." : "🗑️"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Week 5 Grounded Q&A & Evidence Retrieval Modal */}
      {qaModal.open && (
        <div
          className="modal-backdrop"
          onClick={() => setQaModal({ open: false, contract: null, query: "", loading: false, error: null, response: null })}
        >
          <div className="modal-container" style={{ maxWidth: "800px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>
                  🤖 {qaModal.contract ? `Ask AI: ${qaModal.contract.title || qaModal.contract.fileName}` : "Contract Library Semantic Search"}
                </h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  {qaModal.contract
                    ? "Grounded Q&A with hybrid reranking, page/section citations, and hallucination defense"
                    : "Cross-contract vector similarity search scoped strictly to your account"}
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => setQaModal({ open: false, contract: null, query: "", loading: false, error: null, response: null })}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Question Query Box */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                <input
                  type="text"
                  className="qa-search-input"
                  style={{ padding: "10px 14px" }}
                  placeholder="Ask a question about obligations, liability, termination, or warranties..."
                  value={qaModal.query}
                  onChange={(e) => setQaModal((prev) => ({ ...prev, query: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      executeQaQuery(qaModal.contract, qaModal.query);
                    }
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => executeQaQuery(qaModal.contract, qaModal.query)}
                  disabled={qaModal.loading || !qaModal.query.trim()}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {qaModal.loading ? "Analyzing..." : "Ask Question"}
                </button>
              </div>

              {/* Sample Quick Prompts */}
              <div className="qa-quick-chips" style={{ marginTop: "0", marginBottom: "16px" }}>
                <span className="qa-chip-label">Try asking:</span>
                {[
                  "What happens if I terminate early?",
                  "Is there a limitation of liability clause?",
                  "Which jurisdiction governs disputes?",
                  "What are the payment deadlines?",
                  "What is the spacecraft spaceflight policy?", // Hallucination defense test
                ].map((sampleQ) => (
                  <button
                    key={sampleQ}
                    type="button"
                    className="qa-chip"
                    onClick={() => {
                      setQaModal((prev) => ({ ...prev, query: sampleQ }));
                      executeQaQuery(qaModal.contract, sampleQ);
                    }}
                  >
                    {sampleQ}
                  </button>
                ))}
              </div>

              {qaModal.loading ? (
                <div className="card loading-card" style={{ padding: "30px" }}>
                  <div className="spinner"></div>
                  <p>Embedding query, executing vector search, and reranking passages...</p>
                </div>
              ) : qaModal.error ? (
                <div className="toast-alert toast-error">⚠️ {qaModal.error}</div>
              ) : qaModal.response ? (
                <div>
                  {/* Hallucination Defense Banner if Insufficient Information */}
                  {qaModal.response.insufficient_information ? (
                    <div className="qa-insufficient-banner">
                      <span style={{ fontSize: "1.4rem" }}>🛡️</span>
                      <div>
                        <strong>Hallucination Defense Triggered:</strong>
                        <p style={{ marginTop: "4px", fontSize: "0.88rem" }}>
                          {qaModal.response.message || "Insufficient evidence in contract to formulate a safe answer."}
                        </p>
                        <p style={{ marginTop: "6px", fontSize: "0.84rem", color: "var(--text-secondary)" }}>
                          {qaModal.response.answer}
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* Grounded Answer Card */
                    <div className="qa-answer-card">
                      <div className="qa-answer-header">
                        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#a5b4fc" }}>
                          GROUNDED ANSWER
                        </span>
                        {qaModal.response.confidence && (
                          <span
                            className={`qa-confidence-badge confidence-${(
                              qaModal.response.confidence || "medium"
                            ).toLowerCase()}`}
                          >
                            {qaModal.response.confidence} CONFIDENCE
                          </span>
                        )}
                      </div>
                      <p className="qa-answer-text">{qaModal.response.answer}</p>

                      {qaModal.response.citations && qaModal.response.citations.length > 0 && (
                        <div>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>
                            CITATIONS:
                          </span>
                          <div className="qa-citations-list">
                            {qaModal.response.citations.map((cite, i) => (
                              <span key={i} className="qa-citation-chip">
                                📍 {cite}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Retrieved Evidence Passages */}
                  <h4 style={{ margin: "16px 0 10px", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                    Retrieved Evidence Passages ({qaModal.response.results?.length || 0})
                  </h4>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {(qaModal.response.results || []).map((passage, idx) => (
                      <div key={passage.chunk_id || idx} className="qa-passage-card">
                        <div className="qa-passage-meta">
                          <span className="qa-citation-tag">
                            📍 {passage.citation || `Page ${passage.page_number}, Section: ${passage.section}`}
                          </span>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {passage.contractTitle && (
                              <span className="qa-score-badge" style={{ color: "#a855f7" }}>
                                {passage.contractTitle}
                              </span>
                            )}
                            <span className="qa-score-badge" title="Reranked Composite Score">
                              Score: {Math.round((passage.score || 0) * 100)}%
                            </span>
                          </div>
                        </div>
                        <p className="qa-passage-text">{passage.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)" }}>
                  <p>Enter a question above or click one of the suggested prompts to see grounded legal answers with page/section citations.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extracted Clauses Inspection Modal */}
      {clausesModal.open && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setClausesModal({ open: false, title: "", clauses: [], loading: false, error: null })
          }
        >
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>📜 {clausesModal.title}</h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Extracted & Vectorized Legal Clauses ({clausesModal.clauses.length})
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() =>
                  setClausesModal({ open: false, title: "", clauses: [], loading: false, error: null })
                }
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {clausesModal.loading ? (
                <div className="card loading-card" style={{ padding: "30px" }}>
                  <div className="spinner"></div>
                  <p>Loading legal clauses from MongoDB vault...</p>
                </div>
              ) : clausesModal.error ? (
                <div className="toast-alert toast-error">⚠️ {clausesModal.error}</div>
              ) : clausesModal.clauses.length === 0 ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "20px" }}>
                  No clauses found. Run extraction on this contract first.
                </p>
              ) : (
                clausesModal.clauses.map((clause, idx) => (
                  <div key={clause._id || idx} className="clause-card">
                    <div className="clause-header">
                      <span className="clause-type-badge">
                        § {clause.clauseType || "General Clause"}
                      </span>
                      <span className={`clause-risk-badge clause-risk-${clause.riskLevel || "low"}`}>
                        {(clause.riskLevel || "low").toUpperCase()} RISK
                      </span>
                    </div>
                    <p className="clause-text">{clause.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;