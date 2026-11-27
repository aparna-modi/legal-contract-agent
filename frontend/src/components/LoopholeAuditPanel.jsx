import { useState } from "react";
import { contractsApi } from "../api/client";
import { AlertTriangleIcon, CheckIcon, CopyIcon, RefreshIcon, ShieldAlertIcon, ShieldCheckIcon } from "./Icons";

const CATEGORY_LABELS = {
  undefined_terminology: "Undefined Terminology",
  unassigned_parameter: "Unassigned Parameter",
  ambiguous_standard: "Ambiguous Standard",
  toothless_obligation: "Toothless Obligation",
  cross_reference_conflict: "Cross-Reference Conflict",
  escape_hatch: "Unilateral Escape Hatch",
  silent_edge_case: "Silent Edge Case",
  statutory_vulnerability: "Statutory Vulnerability",
};

export default function LoopholeAuditPanel({ contract, token, onContractUpdated, onOpenProtectRewrite }) {
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const sc = audit?.scorecard || {
    overall_health: contract.scorecard?.overallHealth ?? Math.max(0, 100 - (contract.riskSummary?.score || 0)),
    risk_score: contract.scorecard?.riskScore ?? contract.riskSummary?.score ?? 0,
    loophole_score: contract.scorecard?.loopholeScore ?? 80,
    user_favorability: contract.scorecard?.userFavorability ?? 60,
    enforceability_score: contract.scorecard?.enforceabilityScore ?? 85,
    projected_health_after_fixes: contract.scorecard?.projectedHealthAfterFixes ?? 92,
    grade: contract.scorecard?.grade || "B",
    readiness_verdict: contract.scorecard?.readinessVerdict || "Run Deep Loophole Audit",
  };

  const loopholes = audit?.loopholes || (contract.loopholes || []).map((lp) => ({
    loophole_id: lp.loopholeId,
    title: lp.title,
    category: lp.category,
    severity: lp.severity,
    location: lp.location,
    quoted_excerpt: lp.quotedExcerpt,
    what_could_go_wrong: lp.whatCouldGoWrong,
    corrective_measure: lp.correctiveMeasure,
    score_impact: lp.scoreImpact,
  }));

  const runDeepAudit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await contractsApi.auditLoopholes(token, contract._id, {
        userParty: contract.userPartyName || "",
        userRole: contract.userRole || "neutral",
        mode: "full_audit",
      });
      setAudit(res);
      if (res.scorecard) {
        onContractUpdated?.({
          ...contract,
          scorecard: {
            overallHealth: res.scorecard.overall_health,
            riskScore: res.scorecard.risk_score,
            loopholeScore: res.scorecard.loophole_score,
            userFavorability: res.scorecard.user_favorability,
            enforceabilityScore: res.scorecard.enforceability_score,
            projectedHealthAfterFixes: res.scorecard.projected_health_after_fixes,
            grade: res.scorecard.grade,
            readinessVerdict: res.scorecard.readiness_verdict,
            totalLoopholes: res.scorecard.total_loopholes,
            criticalLoopholes: res.scorecard.critical_loopholes,
          },
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyFix = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch { /* ignore */ }
  };

  const scoreBars = [
    { label: "Overall Health", value: sc.overall_health, desc: "Composite readiness" },
    { label: "Loophole Tightness", value: sc.loophole_score, desc: "Terminology & edge-case seal" },
    { label: "User Protection", value: sc.user_favorability, desc: contract.userPartyName || "Represented party balance" },
    { label: "Enforceability", value: sc.enforceability_score, desc: "Statutory & execution validity" },
  ];

  return (
    <div className="drawer-stack">
      <section className="panel-section">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow"><ShieldAlertIcon size={13} /> Multi-Axis Legal Scorecard</span>
            <p className="muted-caption">
              {sc.readiness_verdict} · Projected Health After Corrective Measures: <strong>{sc.projected_health_after_fixes}/100</strong>
            </p>
          </div>
          <div className="clause-head-right">
            <span className={`risk-pill ${sc.overall_health >= 75 ? "risk-low" : sc.overall_health >= 55 ? "risk-medium" : "risk-high"}`}>
              GRADE {sc.grade} · {sc.overall_health}/100
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={runDeepAudit} disabled={busy}>
              <RefreshIcon size={13} /> {busy ? "Auditing..." : audit ? "Re-Scan Loopholes" : "Run Deep Loophole Audit"}
            </button>
          </div>
        </div>

        <div className="scorecard-grid">
          {scoreBars.map((bar) => (
            <div key={bar.label} className="scorecard-cell">
              <div className="section-head-row">
                <span className="scorecard-label">{bar.label}</span>
                <strong className="mono-caption">{bar.value}/100</strong>
              </div>
              <div className="mini-score-track">
                <span
                  className={`mini-score-fill ${bar.value >= 75 ? "seg-low" : bar.value >= 50 ? "seg-medium" : "seg-high"}`}
                  style={{ width: `${Math.max(4, Math.min(100, bar.value))}%` }}
                />
              </div>
              <span className="muted-caption">{bar.desc}</span>
            </div>
          ))}
        </div>

        {audit?.executive_assessment && (
          <p className="summary-prose" style={{ marginTop: 10 }}>{audit.executive_assessment}</p>
        )}
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {audit?.unassigned_terms?.length > 0 && (
        <section className="panel-section">
          <span className="section-eyebrow">Unassigned Terms &amp; Open Parameters ({audit.unassigned_terms.length})</span>
          <div className="section-pills-row">
            {audit.unassigned_terms.map((t, i) => (
              <span key={i} className="mono-tag">{t}</span>
            ))}
          </div>
        </section>
      )}

      <section className="panel-section">
        <div className="section-head-row">
          <span className="section-eyebrow">Identified Loopholes &amp; Corrective Measures ({loopholes.length})</span>
          {onOpenProtectRewrite && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenProtectRewrite}>
              <ShieldCheckIcon size={13} /> Rewrite Full Contract for My Side
            </button>
          )}
        </div>

        {busy ? (
          <div className="state-box"><div className="spinner" /><p>Auditing undefined terms, unilateral escape hatches, cross-references, and statutory gaps...</p></div>
        ) : loopholes.length === 0 ? (
          <div className="chat-empty-state">
            <h3>No material drafting loopholes flagged</h3>
            <p>Run a deep counsel audit above to inspect subtle semantic vulnerabilities across every section.</p>
          </div>
        ) : (
          <div className="clause-list">
            {loopholes.map((lp, idx) => {
              const sev = (lp.severity || "medium").toLowerCase();
              const pillTone = sev === "critical" || sev === "high" ? "high" : sev === "medium" ? "medium" : "low";
              const key = lp.loophole_id || `lp-${idx}`;
              return (
                <article key={key} className={`clause-item border-risk-${pillTone}`}>
                  <div className="clause-item-head">
                    <div className="clause-title-wrap">
                      <span className="clause-category">{lp.title}</span>
                      <span className="mono-caption">
                        {CATEGORY_LABELS[lp.category] || lp.category} · {lp.location}
                      </span>
                    </div>
                    <div className="clause-head-right">
                      {lp.score_impact > 0 && <span className="mono-tag">+{lp.score_impact} pts</span>}
                      <span className={`risk-pill risk-${pillTone}`}>{sev.toUpperCase()}</span>
                    </div>
                  </div>

                  {lp.quoted_excerpt && (
                    <p className="clause-quote" style={{ marginTop: 4 }}>&ldquo;{lp.quoted_excerpt}&rdquo;</p>
                  )}

                  <div className="brief-card" style={{ marginTop: 8 }}>
                    <span className="brief-card-label"><AlertTriangleIcon size={12} /> Exposure Scenario (What Could Go Wrong)</span>
                    <p className="clause-explanation-text">{lp.what_could_go_wrong}</p>
                  </div>

                  <div className="remediation-note" style={{ marginTop: 8 }}>
                    <div className="section-head-row" style={{ marginBottom: 4 }}>
                      <strong>Corrective Measure (Drop-In Wording)</strong>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyFix(key, lp.corrective_measure)}>
                        {copiedId === key ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                      </button>
                    </div>
                    <p>{lp.corrective_measure}</p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
