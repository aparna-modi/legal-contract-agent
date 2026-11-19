import { useEffect, useMemo, useState } from "react";
import { contractsApi } from "../api/client";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileTextIcon,
  MessageIcon,
  SearchIcon,
  ShieldAlertIcon,
  XIcon,
} from "./Icons";

const SAMPLE_QUESTIONS = [
  "What happens if either party terminates early?",
  "Is there a limitation of liability cap?",
  "Which governing law and courts apply to disputes?",
  "What are the payment schedule and deadlines?",
];

export default function ContractDrawer({
  contract,
  initialTab = "overview",
  token,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [clauses, setClauses] = useState([]);
  const [clausesLoading, setClausesLoading] = useState(Boolean(contract && token));
  const [clausesError, setClausesError] = useState(null);

  const [riskFilter, setRiskFilter] = useState("all");
  const [clauseSearch, setClauseSearch] = useState("");

  const [qaQuery, setQaQuery] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState(null);
  const [qaResponse, setQaResponse] = useState(null);

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!contract || !token) return;
    let cancelled = false;

    contractsApi
      .clauses(token, contract._id)
      .then((data) => {
        if (!cancelled) {
          setClauses(data.clauses || []);
          setClausesError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setClausesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setClausesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contract, token]);

  useEffect(() => {
    if (!contract) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contract, onClose]);

  const riskCounts = useMemo(() => {
    if (clauses.length > 0) {
      return clauses.reduce(
        (acc, c) => {
          const level = (c.riskLevel || "low").toLowerCase();
          acc[level] = (acc[level] || 0) + 1;
          return acc;
        },
        { high: 0, medium: 0, low: 0 }
      );
    }
    return {
      high: contract?.riskSummary?.high || 0,
      medium: contract?.riskSummary?.medium || 0,
      low: contract?.riskSummary?.low || 0,
    };
  }, [clauses, contract]);

  const filteredClauses = useMemo(() => {
    const term = clauseSearch.trim().toLowerCase();
    return clauses.filter((clause) => {
      const level = (clause.riskLevel || "low").toLowerCase();
      if (riskFilter !== "all" && level !== riskFilter) return false;
      if (!term) return true;
      return (
        (clause.clauseType || "").toLowerCase().includes(term) ||
        (clause.text || "").toLowerCase().includes(term) ||
        (clause.sectionHeading || "").toLowerCase().includes(term) ||
        (clause.riskReason || "").toLowerCase().includes(term)
      );
    });
  }, [clauses, riskFilter, clauseSearch]);

  if (!contract) return null;

  const facts = contract.keyFacts || {};
  const missingClauses = contract.missingClauses || [];
  const totalRiskItems = Math.max(1, riskCounts.high + riskCounts.medium + riskCounts.low);
  const overallRisk = contract.riskSummary?.overallLevel || (riskCounts.high > 0 ? "high" : riskCounts.medium > 0 ? "medium" : "low");
  const riskScore = contract.riskSummary?.score ?? 0;

  const handleAsk = async (questionText) => {
    const q = (questionText ?? qaQuery).trim();
    if (!q) return;

    setQaQuery(q);
    setQaLoading(true);
    setQaError(null);
    try {
      const data = await contractsApi.ask(token, contract._id, q);
      setQaResponse(data);
    } catch (err) {
      setQaError(err.message);
    } finally {
      setQaLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await contractsApi.downloadReport(token, contract._id, contract.title || contract.fileName);
    } catch (err) {
      setClausesError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${contract.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <div className="drawer-title-group">
            <div className="drawer-meta-line">
              <span className="mono-tag">{(contract.fileType || "doc").toUpperCase()}</span>
              <span className={`risk-pill risk-${overallRisk}`}>
                {overallRisk.toUpperCase()} RISK · {riskScore}/100
              </span>
              <span className="drawer-meta-sep">
                {contract.pageCount || 1} {contract.pageCount === 1 ? "page" : "pages"}
              </span>
              <span className="drawer-meta-sep">
                {(contract.totalTokens || 0).toLocaleString()} tokens
              </span>
            </div>
            <h2 className="drawer-title">{contract.title || contract.fileName}</h2>
            <p className="drawer-filename">{contract.fileName}</p>
          </div>

          <div className="drawer-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExport}
              disabled={exporting}
            >
              <DownloadIcon size={15} />
              {exporting ? "Exporting..." : "Export Report"}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close panel"
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>

        <div className="drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            className={`drawer-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <FileTextIcon size={15} />
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "clauses"}
            className={`drawer-tab ${activeTab === "clauses" ? "active" : ""}`}
            onClick={() => setActiveTab("clauses")}
          >
            <ShieldAlertIcon size={15} />
            Clauses & Risks
            <span className="tab-count">{clauses.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "qa"}
            className={`drawer-tab ${activeTab === "qa" ? "active" : ""}`}
            onClick={() => setActiveTab("qa")}
          >
            <MessageIcon size={15} />
            Ask Contract
          </button>
        </div>

        <div className="drawer-body">
          {activeTab === "overview" && (
            <div className="drawer-stack">
              <section className="panel-section">
                <div className="section-eyebrow">Executive Summary</div>
                <p className="summary-prose">
                  {contract.summary ||
                    "Re-run analysis on this document to generate an executive summary and structured key facts."}
                </p>
              </section>

              <section className="panel-section">
                <div className="section-head-row">
                  <span className="section-eyebrow">Risk Distribution</span>
                  <span className="mono-caption">
                    {riskCounts.high} High · {riskCounts.medium} Medium · {riskCounts.low} Low
                  </span>
                </div>
                <div className="risk-bar" role="img" aria-label="Clause risk breakdown">
                  <div
                    className="risk-bar-seg seg-high"
                    style={{ width: `${(riskCounts.high / totalRiskItems) * 100}%` }}
                  />
                  <div
                    className="risk-bar-seg seg-medium"
                    style={{ width: `${(riskCounts.medium / totalRiskItems) * 100}%` }}
                  />
                  <div
                    className="risk-bar-seg seg-low"
                    style={{ width: `${(riskCounts.low / totalRiskItems) * 100}%` }}
                  />
                </div>
              </section>

              <section className="panel-section">
                <div className="section-eyebrow">Extracted Key Facts</div>
                <dl className="facts-grid">
                  <div className="fact-item">
                    <dt>Parties</dt>
                    <dd>
                      {Array.isArray(facts.parties) && facts.parties.length > 0
                        ? facts.parties.join(" · ")
                        : "Not specified"}
                    </dd>
                  </div>
                  <div className="fact-item">
                    <dt>Effective Date</dt>
                    <dd>{facts.effectiveDate || "Not specified"}</dd>
                  </div>
                  <div className="fact-item">
                    <dt>Term / Duration</dt>
                    <dd>{facts.expiryOrTerm || "Not specified"}</dd>
                  </div>
                  <div className="fact-item">
                    <dt>Payment Terms</dt>
                    <dd>{facts.paymentTerms || "Not specified"}</dd>
                  </div>
                  <div className="fact-item">
                    <dt>Notice Period</dt>
                    <dd>{facts.noticePeriod || "Not specified"}</dd>
                  </div>
                  <div className="fact-item">
                    <dt>Governing Law</dt>
                    <dd>{facts.governingLaw || "Not specified"}</dd>
                  </div>
                </dl>
              </section>

              {Array.isArray(facts.keyObligations) && facts.keyObligations.length > 0 && (
                <section className="panel-section">
                  <div className="section-eyebrow">Primary Obligations</div>
                  <ul className="clean-list">
                    {facts.keyObligations.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}

              {missingClauses.length > 0 && (
                <section className="panel-section">
                  <div className="section-head-row">
                    <span className="section-eyebrow">Missing Standard Protections</span>
                    <span className="mono-caption">{missingClauses.length} flagged</span>
                  </div>
                  <div className="missing-list">
                    {missingClauses.map((item, idx) => (
                      <div key={idx} className="missing-item">
                        <div className="missing-item-head">
                          <span className="missing-item-title">
                            <AlertTriangleIcon size={14} />
                            {item.clauseType}
                          </span>
                          <span className={`risk-pill risk-${item.severity || "medium"}`}>
                            {(item.severity || "medium").toUpperCase()}
                          </span>
                        </div>
                        <p className="missing-item-reason">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="legal-disclaimer">
                AI-assisted contract analysis is intended for first-pass review and does not
                replace independent advice from qualified legal counsel.
              </p>
            </div>
          )}

          {activeTab === "clauses" && (
            <div className="drawer-stack">
              <div className="clause-toolbar">
                <div className="segmented-control">
                  {[
                    { key: "all", label: `All (${clauses.length})` },
                    { key: "high", label: `High (${riskCounts.high})` },
                    { key: "medium", label: `Medium (${riskCounts.medium})` },
                    { key: "low", label: `Low (${riskCounts.low})` },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`seg-btn ${riskFilter === opt.key ? "active" : ""}`}
                      onClick={() => setRiskFilter(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="inline-search">
                  <SearchIcon size={15} />
                  <input
                    type="text"
                    value={clauseSearch}
                    onChange={(e) => setClauseSearch(e.target.value)}
                    placeholder="Filter clauses by keyword..."
                  />
                </div>
              </div>

              {clausesLoading ? (
                <div className="state-box">
                  <div className="spinner" />
                  <p>Loading extracted clauses...</p>
                </div>
              ) : clausesError ? (
                <div className="alert alert-error">{clausesError}</div>
              ) : filteredClauses.length === 0 ? (
                <div className="state-box">
                  <p>No clauses match the selected filter.</p>
                </div>
              ) : (
                <div className="clause-list">
                  {filteredClauses.map((clause, idx) => {
                    const level = (clause.riskLevel || "low").toLowerCase();
                    return (
                      <article key={clause._id || idx} className={`clause-item border-risk-${level}`}>
                        <div className="clause-item-head">
                          <div className="clause-title-wrap">
                            <span className="clause-category">{clause.clauseType}</span>
                            <span className="clause-location">
                              Page {clause.pageNumber || 1} · {clause.sectionHeading || "General"}
                            </span>
                          </div>
                          <span className={`risk-pill risk-${level}`}>{level.toUpperCase()}</span>
                        </div>

                        {clause.riskReason && (
                          <p className="clause-rationale">{clause.riskReason}</p>
                        )}
                        <p className="clause-quote">{clause.text}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "qa" && (
            <div className="drawer-stack">
              <form
                className="qa-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk();
                }}
              >
                <input
                  type="text"
                  className="text-input"
                  value={qaQuery}
                  onChange={(e) => setQaQuery(e.target.value)}
                  placeholder="Ask a specific question about this contract..."
                  disabled={qaLoading}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={qaLoading || !qaQuery.trim()}
                >
                  {qaLoading ? "Reviewing..." : "Ask"}
                </button>
              </form>

              <div className="prompt-chips">
                {SAMPLE_QUESTIONS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="chip-btn"
                    onClick={() => handleAsk(sample)}
                    disabled={qaLoading}
                  >
                    {sample}
                  </button>
                ))}
              </div>

              {qaLoading && (
                <div className="state-box">
                  <div className="spinner" />
                  <p>Retrieving relevant passages and verifying citations...</p>
                </div>
              )}

              {qaError && <div className="alert alert-error">{qaError}</div>}

              {!qaLoading && qaResponse && (
                <div className="qa-result-stack">
                  {qaResponse.insufficient_information ? (
                    <div className="qa-refusal-box">
                      <div className="qa-refusal-head">
                        <AlertTriangleIcon size={16} />
                        <strong>Not supported by this contract</strong>
                      </div>
                      <p>{qaResponse.answer}</p>
                      {qaResponse.message && (
                        <span className="mono-caption">{qaResponse.message}</span>
                      )}
                    </div>
                  ) : (
                    <div className="qa-answer-box">
                      <div className="qa-answer-top">
                        <span className="qa-answer-label">
                          <CheckCircleIcon size={15} />
                          Grounded Answer
                        </span>
                        {qaResponse.confidence && (
                          <span
                            className={`confidence-pill conf-${qaResponse.confidence.toLowerCase()}`}
                          >
                            {qaResponse.confidence} CONFIDENCE
                          </span>
                        )}
                      </div>
                      <p className="qa-answer-body">{qaResponse.answer}</p>
                      {qaResponse.citations && qaResponse.citations.length > 0 && (
                        <div className="citation-row">
                          {qaResponse.citations.map((cite, i) => (
                            <span key={i} className="citation-tag">
                              {cite}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {qaResponse.results && qaResponse.results.length > 0 && (
                    <div className="evidence-section">
                      <div className="section-eyebrow">
                        Supporting Passages ({qaResponse.results.length})
                      </div>
                      <div className="evidence-list">
                        {qaResponse.results.map((item, idx) => (
                          <div key={item.chunk_id || idx} className="evidence-card">
                            <div className="evidence-meta">
                              <span className="citation-inline">
                                {item.citation || `Page ${item.page_number}, ${item.section}`}
                              </span>
                              <span className="mono-caption">
                                {Math.round((item.score || 0) * 100)}% relevance
                              </span>
                            </div>
                            <p className="evidence-text">{item.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!qaLoading && !qaResponse && !qaError && (
                <div className="state-box muted">
                  <p>
                    Every answer is generated strictly from retrieved clauses in this document,
                    with page and section citations. If a topic is missing, the assistant will say
                    so rather than guess.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
