import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CompareIcon, PlusIcon, SwapIcon } from "../components/Icons";

export default function Compare() {
  const { token, isAuthenticated } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loadingList, setLoadingList] = useState(Boolean(token));

  const [contractAId, setContractAId] = useState("");
  const [contractBId, setContractBId] = useState("");
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeDiffTab, setActiveDiffTab] = useState("modified");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    contractsApi
      .list(token)
      .then((data) => {
        if (cancelled) return;
        const analyzed = (data.contracts || []).filter((c) => c.status === "completed");
        setContracts(analyzed);
        if (analyzed.length >= 2) {
          setContractAId((prev) => prev || analyzed[0]._id);
          setContractBId((prev) => prev || analyzed[1]._id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!isAuthenticated) {
    return (
      <div className="empty-box surface-card centered-card">
        <h3>Sign in to compare contracts</h3>
        <p>Select two analyzed agreements from your workspace to inspect clause-level changes.</p>
        <Link to="/login" className="btn btn-primary">
          Sign in
        </Link>
      </div>
    );
  }

  const handleSwap = () => {
    setContractAId(contractBId);
    setContractBId(contractAId);
    setResult(null);
  };

  const handleCompare = async (e) => {
    e.preventDefault();
    if (!contractAId || !contractBId) return;
    if (contractAId === contractBId) {
      setError("Choose two different contracts to compare.");
      return;
    }

    setComparing(true);
    setError(null);
    setResult(null);
    try {
      const data = await contractsApi.compare(token, contractAId, contractBId);
      setResult(data);
      if (data.counts?.modified > 0) setActiveDiffTab("modified");
      else if (data.counts?.added > 0) setActiveDiffTab("added");
      else if (data.counts?.removed > 0) setActiveDiffTab("removed");
      else setActiveDiffTab("unchanged");
    } catch (err) {
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Contract Comparison</h1>
          <p className="page-description">
            Align clauses semantically across two analyzed agreements to surface modified, added,
            and removed terms.
          </p>
        </div>
        <Link to="/upload" className="btn btn-secondary">
          <PlusIcon size={15} />
          Upload Contract
        </Link>
      </div>

      {loadingList ? (
        <div className="surface-card state-box">
          <div className="spinner" />
          <p>Loading analyzed contracts...</p>
        </div>
      ) : contracts.length < 2 ? (
        <div className="surface-card empty-box">
          <CompareIcon size={28} />
          <h3>At least two analyzed contracts are needed</h3>
          <p>
            Upload and analyze two agreements (for example, v1 and v2 of a vendor MSA or two
            competing offers) to run a clause-by-clause comparison.
          </p>
          <div className="hero-actions">
            <Link to="/upload" className="btn btn-primary">
              Upload Contract
            </Link>
            <Link to="/" className="btn btn-secondary">
              Back to Workspace
            </Link>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={handleCompare} className="surface-card compare-selector">
            <div className="compare-picker-grid">
              <div className="field">
                <label htmlFor="contract-a" className="field-label">
                  Baseline Contract (A)
                </label>
                <select
                  id="contract-a"
                  className="select-input"
                  value={contractAId}
                  onChange={(e) => setContractAId(e.target.value)}
                  disabled={comparing}
                >
                  {contracts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.title || c.fileName}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="icon-btn swap-btn"
                onClick={handleSwap}
                disabled={comparing}
                title="Swap baseline and revised contracts"
                aria-label="Swap contracts"
              >
                <SwapIcon size={16} />
              </button>

              <div className="field">
                <label htmlFor="contract-b" className="field-label">
                  Revised / Comparison Contract (B)
                </label>
                <select
                  id="contract-b"
                  className="select-input"
                  value={contractBId}
                  onChange={(e) => setContractBId(e.target.value)}
                  disabled={comparing}
                >
                  {contracts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.title || c.fileName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="compare-submit-row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={comparing || !contractAId || !contractBId}
              >
                <CompareIcon size={15} />
                {comparing ? "Comparing clauses..." : "Run Comparison"}
              </button>
            </div>
          </form>

          {error && <div className="alert alert-error">{error}</div>}

          {comparing && (
            <div className="surface-card state-box">
              <div className="spinner" />
              <p>Matching clauses semantically and evaluating material differences...</p>
            </div>
          )}

          {result && (
            <div className="compare-results">
              <section className="surface-card compare-summary-card">
                <div className="section-eyebrow">Comparison Overview</div>
                <p className="summary-prose">{result.executive_summary}</p>

                {result.material_changes && result.material_changes.length > 0 && (
                  <div className="compare-highlights">
                    <div className="section-eyebrow">Key Differences</div>
                    <ul className="clean-list">
                      {result.material_changes.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.recommendation && (
                  <div className="recommendation-box">
                    <strong>Reviewer Takeaway:</strong> {result.recommendation}
                  </div>
                )}
              </section>

              <div className="diff-tabs-bar">
                {[
                  { key: "modified", label: "Modified", count: result.counts?.modified || 0 },
                  { key: "added", label: "Added in B", count: result.counts?.added || 0 },
                  { key: "removed", label: "Removed from A", count: result.counts?.removed || 0 },
                  { key: "unchanged", label: "Unchanged", count: result.counts?.unchanged || 0 },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`diff-tab diff-tab-${tab.key} ${
                      activeDiffTab === tab.key ? "active" : ""
                    }`}
                    onClick={() => setActiveDiffTab(tab.key)}
                  >
                    <span>{tab.label}</span>
                    <span className="tab-count">{tab.count}</span>
                  </button>
                ))}
              </div>

              <div className="diff-list">
                {activeDiffTab === "modified" &&
                  (result.modified.length === 0 ? (
                    <div className="surface-card state-box muted">
                      <p>No modified clauses detected.</p>
                    </div>
                  ) : (
                    result.modified.map((item, idx) => (
                      <article key={idx} className="surface-card diff-card">
                        <div className="diff-card-head">
                          <span className="clause-category">{item.clause_type}</span>
                          <span className="mono-caption">
                            {Math.round((item.similarity || 0) * 100)}% semantic match
                          </span>
                        </div>

                        {item.change_notes && item.change_notes.length > 0 && (
                          <div className="diff-notes">
                            {item.change_notes.map((note, i) => (
                              <span key={i} className="diff-note-pill">
                                {note}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="diff-columns">
                          <div className="diff-pane pane-a">
                            <div className="diff-pane-head">
                              <span>{result.contract_a}</span>
                              <span className={`risk-pill risk-${item.risk_a || "low"}`}>
                                {(item.risk_a || "low").toUpperCase()}
                              </span>
                            </div>
                            <p>{item.text_a}</p>
                          </div>

                          <div className="diff-pane pane-b">
                            <div className="diff-pane-head">
                              <span>{result.contract_b}</span>
                              <span className={`risk-pill risk-${item.risk_b || "low"}`}>
                                {(item.risk_b || "low").toUpperCase()}
                              </span>
                            </div>
                            <p>{item.text_b}</p>
                          </div>
                        </div>
                      </article>
                    ))
                  ))}

                {activeDiffTab === "added" &&
                  (result.added.length === 0 ? (
                    <div className="surface-card state-box muted">
                      <p>No clauses were newly added in {result.contract_b}.</p>
                    </div>
                  ) : (
                    result.added.map((item, idx) => (
                      <article key={idx} className="surface-card diff-single diff-added">
                        <div className="diff-card-head">
                          <span className="clause-category">Added · {item.clause_type}</span>
                          <span className={`risk-pill risk-${item.risk_level || "low"}`}>
                            {(item.risk_level || "low").toUpperCase()}
                          </span>
                        </div>
                        <p className="clause-quote">{item.text}</p>
                      </article>
                    ))
                  ))}

                {activeDiffTab === "removed" &&
                  (result.removed.length === 0 ? (
                    <div className="surface-card state-box muted">
                      <p>No clauses were removed from {result.contract_a}.</p>
                    </div>
                  ) : (
                    result.removed.map((item, idx) => (
                      <article key={idx} className="surface-card diff-single diff-removed">
                        <div className="diff-card-head">
                          <span className="clause-category">Removed · {item.clause_type}</span>
                          <span className={`risk-pill risk-${item.risk_level || "low"}`}>
                            {(item.risk_level || "low").toUpperCase()}
                          </span>
                        </div>
                        <p className="clause-quote">{item.text}</p>
                      </article>
                    ))
                  ))}

                {activeDiffTab === "unchanged" &&
                  (result.unchanged.length === 0 ? (
                    <div className="surface-card state-box muted">
                      <p>No identical clauses found between these two agreements.</p>
                    </div>
                  ) : (
                    result.unchanged.map((item, idx) => (
                      <article key={idx} className="surface-card diff-single">
                        <div className="diff-card-head">
                          <span className="clause-category">{item.clause_type}</span>
                          <span className="mono-caption">Unchanged</span>
                        </div>
                        <p className="clause-quote">{item.text_a}</p>
                      </article>
                    ))
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
