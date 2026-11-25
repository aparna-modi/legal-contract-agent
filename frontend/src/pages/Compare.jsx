import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CompareIcon, DownloadIcon, PlusIcon, SwapIcon } from "../components/Icons";
import { FadePanel, PageReveal } from "../components/Motion";
import { SPRING_SNAPPY } from "../components/motionTokens";

function wordDiff(textA = "", textB = "") {
  const a = String(textA).split(/(\s+)/);
  const b = String(textB).split(/(\s+)/);
  if (a.length > 350 || b.length > 350) {
    return { left: [{ text: textA, type: "same" }], right: [{ text: textB, type: "same" }] };
  }
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left = [];
  const right = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      left.push({ text: a[i], type: "same" });
      right.push({ text: b[j++], type: "same" });
      i++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: a[i++], type: "del" });
    } else {
      right.push({ text: b[j++], type: "add" });
    }
  }
  while (i < m) left.push({ text: a[i++], type: "del" });
  while (j < n) right.push({ text: b[j++], type: "add" });
  return { left, right };
}

function exportComparisonMarkdown(result) {
  if (!result) return;
  const lines = [
    `# Revision Comparison: ${result.contract_a} vs ${result.contract_b}`,
    "",
    "> **Disclaimer:** AI-assisted revision diff for informational review only — not legal advice.",
    "",
    "## Executive Summary",
    result.executive_summary || "Comparison completed.",
    "",
  ];
  if (result.material_changes?.length) {
    lines.push("## Material Differences", ...result.material_changes.map((c) => `- ${c}`), "");
  }
  if (result.recommendation) {
    lines.push(`**Review Takeaway:** ${result.recommendation}`, "");
  }
  if (result.modified?.length) {
    lines.push(`## Modified Clauses (${result.modified.length})`, "");
    result.modified.forEach((m, idx) => {
      lines.push(`### ${idx + 1}. ${m.clause_type} (${Math.round((m.similarity || 0) * 100)}% match)`);
      if (m.change_notes?.length) lines.push(`- **Notes:** ${m.change_notes.join("; ")}`);
      lines.push(`- **${result.contract_a} (${(m.risk_a || "low").toUpperCase()}):** ${m.text_a}`);
      lines.push(`- **${result.contract_b} (${(m.risk_b || "low").toUpperCase()}):** ${m.text_b}`, "");
    });
  }
  if (result.added?.length) {
    lines.push(`## Added in ${result.contract_b} (${result.added.length})`, "");
    result.added.forEach((a, idx) => {
      lines.push(`### ${idx + 1}. ${a.clause_type} (${(a.risk_level || "low").toUpperCase()})`, "", a.text, "");
    });
  }
  if (result.removed?.length) {
    lines.push(`## Removed from ${result.contract_a} (${result.removed.length})`, "");
    result.removed.forEach((r, idx) => {
      lines.push(`### ${idx + 1}. ${r.clause_type} (${(r.risk_level || "low").toUpperCase()})`, "", r.text, "");
    });
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `comparison_${Date.now()}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const RedlineText = ({ segments }) => (
  <p className="redline-prose">
    {segments.map((s, i) =>
      s.type === "del" ? <del key={i} className="diff-del">{s.text}</del>
      : s.type === "add" ? <ins key={i} className="diff-add">{s.text}</ins>
      : <span key={i}>{s.text}</span>
    )}
  </p>
);

export default function Compare() {
  const { token } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("modified");
  const [redline, setRedline] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;
    contractsApi.list(token)
      .then(({ contracts: list = [] }) => {
        if (!active) return;
        const done = list.filter((c) => c.status === "completed");
        setContracts(done);
        if (done.length >= 2) {
          setIdA((v) => v || done[0]._id);
          setIdB((v) => v || done[1]._id);
        }
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const compare = async (e) => {
    e.preventDefault();
    if (!idA || !idB) return;
    if (idA === idB) return setError("Choose two different contracts to compare.");
    setComparing(true);
    setError(null);
    setResult(null);
    try {
      const data = await contractsApi.compare(token, idA, idB);
      setResult(data);
      const firstNonEmpty = ["modified", "added", "removed", "unchanged"].find((k) => (data.counts?.[k] || 0) > 0);
      setTab(firstNonEmpty || "unchanged");
    } catch (err) {
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Revision Comparison</h1>
          <p className="page-description">Align clauses across two agreements with word-level redlines and risk-shift alerts.</p>
        </div>
        <div className="page-header-actions">
          {result && (
            <button type="button" className="btn btn-secondary" onClick={() => exportComparisonMarkdown(result)}>
              <DownloadIcon size={15} /> Export Diff (.md)
            </button>
          )}
          <Link to="/upload" className="btn btn-secondary"><PlusIcon size={15} /> Upload Contract</Link>
        </div>
      </div>

      {loading ? (
        <div className="surface-card state-box"><div className="spinner" /><p>Loading analyzed contracts...</p></div>
      ) : contracts.length < 2 ? (
        <div className="surface-card empty-box">
          <CompareIcon size={28} />
          <h3>At least two analyzed contracts are needed</h3>
          <p>Upload and analyze two agreements to run a clause-by-clause redline comparison.</p>
          <div className="hero-actions">
            <Link to="/upload" className="btn btn-primary">Upload Contract</Link>
            <Link to="/" className="btn btn-secondary">Back to Portfolio</Link>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={compare} className="surface-card compare-selector">
            <div className="compare-picker-grid">
              <div className="field">
                <label htmlFor="contract-a" className="field-label">Baseline Contract (A)</label>
                <select id="contract-a" className="select-input" value={idA} onChange={(e) => setIdA(e.target.value)} disabled={comparing}>
                  {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
                </select>
              </div>
              <button
                type="button"
                className="icon-btn swap-btn"
                title="Swap contracts"
                aria-label="Swap contracts"
                disabled={comparing}
                onClick={() => { setIdA(idB); setIdB(idA); setResult(null); }}
              >
                <SwapIcon size={16} />
              </button>
              <div className="field">
                <label htmlFor="contract-b" className="field-label">Revised Contract (B)</label>
                <select id="contract-b" className="select-input" value={idB} onChange={(e) => setIdB(e.target.value)} disabled={comparing}>
                  {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
                </select>
              </div>
            </div>
            <div className="compare-submit-row">
              <button type="submit" className="btn btn-primary" disabled={comparing || !idA || !idB}>
                <CompareIcon size={15} /> {comparing ? "Comparing..." : "Run Redline Comparison"}
              </button>
            </div>
          </form>

          {error && <div className="alert alert-error">{error}</div>}
          {comparing && <div className="surface-card state-box"><div className="spinner" /><p>Matching clauses semantically...</p></div>}

          {result && (
            <div className="compare-results">
              <section className="surface-card compare-summary-card">
                <div className="section-eyebrow">Comparison Overview</div>
                <p className="summary-prose">{result.executive_summary}</p>
                {result.material_changes?.length > 0 && (
                  <div className="compare-highlights">
                    <div className="section-eyebrow">Material Differences</div>
                    <ul className="clean-list">
                      {result.material_changes.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {result.recommendation && (
                  <div className="recommendation-box"><strong>Review Takeaway:</strong> {result.recommendation}</div>
                )}
                <p className="legal-disclaimer">AI-assisted revision diff for informational review only — not legal advice.</p>
              </section>

              <div className="diff-toolbar-row">
                <div className="diff-tabs-bar">
                  {[
                    ["modified", "Modified"],
                    ["added", "Added in B"],
                    ["removed", "Removed from A"],
                    ["unchanged", "Unchanged"],
                  ].map(([k, label]) => (
                    <button key={k} type="button" className={`diff-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                      {tab === k && (
                        <motion.span layoutId="compare-tab-bg" className="diff-tab-bg" transition={SPRING_SNAPPY} />
                      )}
                      <span>{label}</span>
                      <span className="tab-count">{result.counts?.[k] || 0}</span>
                    </button>
                  ))}
                </div>
                {tab === "modified" && (
                  <div className="segmented-control">
                    <button type="button" className={`seg-btn ${redline ? "active" : ""}`} onClick={() => setRedline(true)}>Redline Diff</button>
                    <button type="button" className={`seg-btn ${!redline ? "active" : ""}`} onClick={() => setRedline(false)}>Clean Text</button>
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait">
                <FadePanel panelKey={tab} className="diff-list">
                  {tab === "modified" && (
                    result.modified.length === 0
                      ? <div className="surface-card state-box"><p>No modified clauses detected.</p></div>
                      : result.modified.map((item, i) => {
                          const diff = redline ? wordDiff(item.text_a, item.text_b) : null;
                          return (
                            <article key={i} className="surface-card diff-card">
                              <div className="diff-card-head">
                                <span className="clause-category">{item.clause_type}</span>
                                <span className="mono-caption">{Math.round((item.similarity || 0) * 100)}% semantic match</span>
                              </div>
                              {item.change_notes?.length > 0 && (
                                <div className="diff-notes">
                                  {item.change_notes.map((n, j) => <span key={j} className="diff-note-pill">{n}</span>)}
                                </div>
                              )}
                              <div className="diff-columns">
                                {[
                                  [result.contract_a, item.risk_a, item.text_a, diff?.left],
                                  [result.contract_b, item.risk_b, item.text_b, diff?.right],
                                ].map(([docTitle, risk, text, segs], side) => (
                                  <div key={side} className="diff-pane">
                                    <div className="diff-pane-head">
                                      <span>{docTitle}</span>
                                      <span className={`risk-pill risk-${risk || "low"}`}>{(risk || "low").toUpperCase()}</span>
                                    </div>
                                    {redline ? <RedlineText segments={segs} /> : <p>{text}</p>}
                                  </div>
                                ))}
                              </div>
                            </article>
                          );
                        })
                  )}

                  {(tab === "added" || tab === "removed") && (
                    result[tab].length === 0
                      ? <div className="surface-card state-box"><p>No {tab} clauses found.</p></div>
                      : result[tab].map((item, i) => (
                          <article key={i} className={`surface-card diff-single diff-${tab}`}>
                            <div className="diff-card-head">
                              <span className="clause-category">{tab === "added" ? "Added" : "Removed"} · {item.clause_type}</span>
                              <span className={`risk-pill risk-${item.risk_level || "low"}`}>{(item.risk_level || "low").toUpperCase()}</span>
                            </div>
                            <p className="clause-quote">{item.text}</p>
                          </article>
                        ))
                  )}

                  {tab === "unchanged" && (
                    result.unchanged.length === 0
                      ? <div className="surface-card state-box"><p>No identical clauses found.</p></div>
                      : result.unchanged.map((item, i) => (
                          <article key={i} className="surface-card diff-single">
                            <div className="diff-card-head">
                              <span className="clause-category">{item.clause_type}</span>
                              <span className="mono-caption">Unchanged</span>
                            </div>
                            <p className="clause-quote">{item.text_a}</p>
                          </article>
                        ))
                  )}
                </FadePanel>
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </PageReveal>
  );
}
