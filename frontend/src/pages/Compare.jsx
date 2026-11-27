import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { baselinesApi, contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, CompareIcon, CopyIcon, DownloadIcon, PlusIcon, ScaleIcon, SlidersIcon, SwapIcon } from "../components/Icons";
import { ExpandableSection, FadePanel, PageReveal } from "../components/Motion";
import { SPRING_SNAPPY } from "../components/motionTokens";

function computeLcsDiff(a, b) {
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

function wordDiff(textA = "", textB = "") {
  const a = String(textA).split(/(\s+)/);
  const b = String(textB).split(/(\s+)/);
  if (a.length <= 240 && b.length <= 240) {
    return computeLcsDiff(a, b);
  }
  // Sentence-level diff for long clauses so redlines stay crisp without O(n^2) memory spikes
  const sentA = String(textA).split(/(?<=[.;?!])\s+/).map((s) => `${s} `);
  const sentB = String(textB).split(/(?<=[.;?!])\s+/).map((s) => `${s} `);
  if (sentA.length <= 160 && sentB.length <= 160) {
    return computeLcsDiff(sentA, sentB);
  }
  return { left: [{ text: textA, type: "del" }], right: [{ text: textB, type: "add" }] };
}

function exportComparisonMarkdown(result) {
  if (!result) return;
  const lines = [
    `# Revision Comparison: ${result.contract_a} vs ${result.contract_b}`,
    "",
    "> **Counsel Notice:** Clause-level revision diff prepared for pre-execution review.",
    "",
    "## Executive Summary",
    result.executive_summary || "Comparison completed.",
    "",
  ];
  if (result.favorability_assessment) {
    lines.push(`**Commercial Balance:** ${result.favorability_assessment}`, "");
  }
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
  const [mode, setMode] = useState("contracts");
  const [contracts, setContracts] = useState([]);
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [benchmarkResult, setBenchmarkResult] = useState(null);
  const [tab, setTab] = useState("modified");
  const [redline, setRedline] = useState(true);

  const [counterRedlines, setCounterRedlines] = useState({});
  const [counterBusy, setCounterBusy] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([
      contractsApi.list(token),
      baselinesApi.list(token).catch(() => ({ baselines: [] })),
    ])
      .then(([contractRes, baseRes]) => {
        if (!active) return;
        const done = (contractRes.contracts || []).filter((c) => c.status === "completed");
        const baseList = baseRes.baselines || [];
        setContracts(done);
        setBaselines(baseList);
        if (done.length >= 1) setIdA((v) => v || done[0]._id);
        if (done.length >= 2) setIdB((v) => v || done[1]._id);
        if (baseList.length >= 1) setBaselineId((v) => v || (baseList[0]._id || baseList[0].id));
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const compare = async (e) => {
    e.preventDefault();
    if (mode === "baseline") {
      if (!idA || !baselineId) return;
      setComparing(true);
      setError(null);
      setBenchmarkResult(null);
      try {
        const res = await baselinesApi.benchmark(token, baselineId, { contractId: idA });
        setBenchmarkResult(res);
      } catch (err) {
        setError(err.message);
      } finally {
        setComparing(false);
      }
      return;
    }

    if (!idA || !idB) return;
    if (idA === idB) return setError("Choose two different contracts to compare.");
    setComparing(true);
    setError(null);
    setResult(null);
    setCounterRedlines({});
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

  const draftCounter = async (idx, item) => {
    if (counterBusy[idx]) return;
    setCounterBusy((p) => ({ ...p, [idx]: true }));
    setError(null);
    try {
      const suggestion = await contractsApi.suggestAdhocRedline(token, {
        clauseType: item.clause_type,
        clauseText: item.text_b,
        riskLevel: item.risk_b || "medium",
        riskReason: (item.change_notes || []).join(" "),
        stance: "balanced",
        customInstruction: `Counter-propose balanced wording closer to the baseline version: "${String(item.text_a || "").slice(0, 320)}"`,
      });
      setCounterRedlines((p) => ({ ...p, [idx]: suggestion }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCounterBusy((p) => ({ ...p, [idx]: false }));
    }
  };

  const copyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1600);
    } catch { /* ignore */ }
  };

  const rc = result?.risk_comparison;
  const bench = benchmarkResult?.benchmark || benchmarkResult;

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Revision &amp; Baseline Comparison</h1>
          <p className="page-description">Compare two contract versions word by word, or benchmark any agreement against your Gold-Standard Firm Baselines.</p>
        </div>
        <div className="page-header-actions">
          {mode === "contracts" && result && (
            <button type="button" className="btn btn-secondary" onClick={() => exportComparisonMarkdown(result)}>
              <DownloadIcon size={15} /> Export Diff (.md)
            </button>
          )}
          <Link to="/upload" className="btn btn-secondary"><PlusIcon size={15} /> Upload Contract</Link>
        </div>
      </div>

      <div className="compare-mode-bar">
        <div className="segmented-control">
          <button
            type="button"
            className={`seg-btn ${mode === "contracts" ? "active" : ""}`}
            onClick={() => { setMode("contracts"); setError(null); }}
          >
            Two Uploaded Contracts
          </button>
          <button
            type="button"
            className={`seg-btn ${mode === "baseline" ? "active" : ""}`}
            onClick={() => { setMode("baseline"); setError(null); }}
          >
            Contract vs. Firm Baseline
          </button>
        </div>
      </div>

      {loading ? (
        <div className="surface-card state-box"><div className="spinner" /><p>Loading analyzed contracts and baselines...</p></div>
      ) : mode === "contracts" && contracts.length < 2 ? (
        <div className="surface-card empty-box">
          <CompareIcon size={26} />
          <h3>At least two analyzed contracts are needed</h3>
          <p>Upload and analyze two agreements to run a clause-by-clause redline comparison, or switch to Firm Baseline mode above.</p>
          <div className="hero-actions">
            <Link to="/upload" className="btn btn-primary">Upload Contract</Link>
            {contracts.length >= 1 && baselines.length >= 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => setMode("baseline")}>
                Benchmark Against Baseline
              </button>
            )}
          </div>
        </div>
      ) : mode === "baseline" && contracts.length < 1 ? (
        <div className="surface-card empty-box">
          <ScaleIcon size={26} />
          <h3>Upload at least one analyzed contract</h3>
          <p>Analyze an agreement first, then benchmark it against curated or custom firm baselines.</p>
          <Link to="/upload" className="btn btn-primary">Upload Contract</Link>
        </div>
      ) : (
        <>
          <form onSubmit={compare} className="surface-card compare-selector">
            {mode === "contracts" ? (
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
            ) : (
              <div className="draft-two-col">
                <div className="field">
                  <label htmlFor="bench-contract" className="field-label">Contract Under Review</label>
                  <select id="bench-contract" className="select-input" value={idA} onChange={(e) => setIdA(e.target.value)} disabled={comparing}>
                    {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="bench-baseline" className="field-label">Gold-Standard / Firm Baseline</label>
                  <select id="bench-baseline" className="select-input" value={baselineId} onChange={(e) => setBaselineId(e.target.value)} disabled={comparing}>
                    {baselines.map((b) => (
                      <option key={b._id || b.id} value={b._id || b.id}>
                        {b.name} {b.isCurated ? "(Firm Standard)" : "(Saved)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="compare-submit-row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={comparing || !idA || (mode === "contracts" ? !idB : !baselineId)}
              >
                <CompareIcon size={15} />{" "}
                {comparing
                  ? mode === "baseline" ? "Benchmarking..." : "Comparing..."
                  : mode === "baseline" ? "Benchmark Against Baseline" : "Run Redline Comparison"}
              </button>
            </div>
          </form>

          {error && <div className="alert alert-error">{error}</div>}
          {comparing && (
            <div className="surface-card state-box">
              <div className="spinner" />
              <p>{mode === "baseline" ? "Scoring contract clauses and structure against the selected firm baseline..." : "Comparing clauses and calculating commercial risk shifts between revisions..."}</p>
            </div>
          )}

          {mode === "baseline" && bench && (
            <div className="compare-results">
              <div className="compare-delta-strip">
                <div className="kpi-card">
                  <span className="kpi-label">Baseline Conformity</span>
                  <span className={`kpi-value ${(bench.conformity_score || 0) >= 80 ? "text-accent" : (bench.conformity_score || 0) >= 60 ? "text-warn" : "text-danger"}`}>
                    {bench.conformity_score ?? 0}<small className="kpi-unit">/100</small>
                  </span>
                  <span className="kpi-sub">Vs. {bench.baseline_title || "Firm Standard"}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Section Coverage</span>
                  <span className="kpi-value">{bench.section_coverage_pct ?? 0}<small className="kpi-unit">%</small></span>
                  <span className="kpi-sub">{bench.matched_baseline_sections?.length || 0} standard sections present</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Presentation Score</span>
                  <span className="kpi-value">{bench.target_presentation_score ?? 0}<small className="kpi-unit">/100</small></span>
                  <span className="kpi-sub">Baseline target: {bench.baseline_presentation_score ?? 100}/100</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Missing Sections</span>
                  <span className={`kpi-value ${(bench.missing_baseline_sections?.length || 0) > 0 ? "text-danger" : "text-accent"}`}>
                    {bench.missing_baseline_sections?.length || 0}
                  </span>
                  <span className="kpi-sub">Absent from target contract</span>
                </div>
              </div>

              <section className="surface-card compare-summary-card">
                <div className="section-eyebrow">Baseline Conformity Assessment</div>
                <p className="summary-prose">{bench.recommendation || "Baseline conformity benchmark completed."}</p>

                {bench.missing_baseline_sections?.length > 0 && (
                  <div className="compare-highlights">
                    <div className="section-eyebrow">Missing Baseline Sections</div>
                    <div className="citation-row">
                      {bench.missing_baseline_sections.map((c, idx) => (
                        <span key={idx} className="risk-pill risk-high">{c}</span>
                      ))}
                    </div>
                  </div>
                )}

                {bench.target_presentation_checklist?.length > 0 && (
                  <div className="compare-highlights">
                    <div className="section-eyebrow">10-Point Legal Presentation Checklist</div>
                    <div className="checklist-compact">
                      {bench.target_presentation_checklist.map((item, idx) => (
                        <div key={idx} className="checklist-row">
                          {item.passed
                            ? <CheckCircleIcon size={13} className="text-accent" />
                            : <AlertTriangleIcon size={13} className="text-danger" />}
                          <span>{item.criterion}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bench.matched_baseline_sections?.length > 0 && (
                  <div className="compare-highlights">
                    <div className="section-eyebrow">Aligned Baseline Sections ({bench.matched_baseline_sections.length})</div>
                    <div className="citation-row">
                      {bench.matched_baseline_sections.map((s, idx) => (
                        <span key={idx} className="risk-pill risk-low">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {mode === "contracts" && result && (
            <div className="compare-results">
              {rc && (
                <div className="compare-delta-strip">
                  <div className="kpi-card">
                    <span className="kpi-label">Baseline Risk (A)</span>
                    <span className="kpi-value">{rc.score_a}<small className="kpi-unit">/100</small></span>
                    <span className="kpi-sub">{(rc.level_a || "low").toUpperCase()} overall</span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">Revised Risk (B)</span>
                    <span className="kpi-value">{rc.score_b}<small className="kpi-unit">/100</small></span>
                    <span className="kpi-sub">{(rc.level_b || "low").toUpperCase()} overall</span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">Net Risk Shift</span>
                    <span className={`kpi-value ${rc.risk_delta > 0 ? "text-danger" : rc.risk_delta < 0 ? "text-accent" : ""}`}>
                      {rc.risk_delta > 0 ? `+${rc.risk_delta}` : rc.risk_delta}
                    </span>
                    <span className="kpi-sub">
                      {rc.direction === "increased" ? "Risk increased in B" : rc.direction === "reduced" ? "Risk reduced in B" : "Neutral risk change"}
                    </span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">Clauses Changed</span>
                    <span className="kpi-value">
                      {(result.counts?.modified || 0) + (result.counts?.added || 0) + (result.counts?.removed || 0)}
                    </span>
                    <span className="kpi-sub">{result.counts?.unchanged || 0} unchanged</span>
                  </div>
                </div>
              )}

              <section className="surface-card compare-summary-card">
                <div className="section-eyebrow">Comparison Overview</div>
                <p className="summary-prose">{result.executive_summary}</p>
                {result.favorability_assessment && (
                  <p className="muted-caption"><strong>Commercial shift:</strong> {result.favorability_assessment}</p>
                )}
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
                <p className="legal-disclaimer">Clause-level revision diff prepared for counsel review prior to execution.</p>
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
                          const cr = counterRedlines[i];
                          return (
                            <article key={i} className="surface-card diff-card">
                              <div className="diff-card-head">
                                <span className="clause-category">{item.clause_type}</span>
                                <div className="clause-head-right">
                                  <span className="mono-caption">{Math.round((item.similarity || 0) * 100)}% semantic match</span>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => draftCounter(i, item)}
                                    disabled={Boolean(counterBusy[i])}
                                  >
                                    <SlidersIcon size={13} /> {counterBusy[i] ? "Drafting..." : cr ? "Regenerate Counter" : "Draft Counter-Redline"}
                                  </button>
                                </div>
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

                              <AnimatePresence>
                                {cr && (
                                  <ExpandableSection className="drafted-missing-box">
                                    <div className="section-head-row">
                                      <span className="section-eyebrow">Proposed Counter-Redline</span>
                                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(`cmp-${i}`, cr.suggested_text)}>
                                        {copiedId === `cmp-${i}` ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                                      </button>
                                    </div>
                                    <p className="redline-suggested-text">{cr.suggested_text}</p>
                                    {cr.rationale && <p className="muted-caption">{cr.rationale}</p>}
                                    {cr.fallback_compromise && (
                                      <div className="tier2-box">
                                        <span className="mono-caption">Tier-2 Compromise</span>
                                        <p>{cr.fallback_compromise}</p>
                                      </div>
                                    )}
                                  </ExpandableSection>
                                )}
                              </AnimatePresence>
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
