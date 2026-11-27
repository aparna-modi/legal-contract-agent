import { useEffect, useState } from "react";
import { contractsApi } from "../api/client";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon, ShieldAlertIcon, ShieldCheckIcon } from "./Icons";

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

export default function DraftHardeningPanel({
  token,
  activeDraftText = "",
  activeDraftTitle = "",
  jurisdiction = "India (Indian Contract Act, 1872)",
  onApplyHardenedToStudio,
}) {
  const [title, setTitle] = useState(activeDraftTitle || "Initial Commercial Draft");
  const [sourceText, setSourceText] = useState(activeDraftText || "");
  const [contracts, setContracts] = useState([]);
  const [auditing, setAuditing] = useState(false);
  const [hardening, setHardening] = useState(false);
  const [auditResult, setAuditResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [hardenedResult, setHardenedResult] = useState(null);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    contractsApi.list(token)
      .then((res) => setContracts((res.contracts || []).filter((c) => c.status === "completed")))
      .catch(() => {});
  }, [token]);

  const loadFromWorkspace = async (contractId) => {
    if (!contractId) return;
    setError(null);
    try {
      const [cData, sumData] = await Promise.all([
        contractsApi.clauses(token, contractId),
        contractsApi.get(token, contractId),
      ]);
      const doc = sumData.contract;
      const joined = (cData.clauses || []).map((c) => `${c.sectionHeading || c.clauseType}\n${c.text}`).join("\n\n");
      setTitle(doc?.title || doc?.fileName || "Loaded Contract Draft");
      setSourceText(joined);
      setAuditResult(null);
      setHardenedResult(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAudit = async (e) => {
    e?.preventDefault();
    if (sourceText.trim().length < 30) {
      return setError("Paste or load an initial draft (at least 30 characters) before scanning for vulnerabilities.");
    }
    setAuditing(true);
    setError(null);
    setHardenedResult(null);
    try {
      const res = await contractsApi.auditDraftLoopholes(token, {
        title: title.trim() || "Initial Contract Draft",
        draftText: sourceText,
      });
      setAuditResult(res);
      const sel = {};
      (res.loopholes || []).forEach((lp) => { sel[lp.loophole_id] = true; });
      setSelectedIds(sel);
    } catch (err) {
      setError(err.message);
    } finally {
      setAuditing(false);
    }
  };

  const handleSealLoopholes = async (singleItem = null) => {
    const items = singleItem
      ? [singleItem]
      : (auditResult?.loopholes || []).filter((lp) => selectedIds[lp.loophole_id]);
    if (!items.length) return setError("Select at least one vulnerability resolution to apply.");

    setHardening(true);
    setError(null);
    try {
      const res = await contractsApi.hardenDraft(token, {
        title: title.trim() || "Hardened Contract Draft",
        draftText: hardenedResult?.hardened_text || sourceText,
        loopholesToFix: items,
        jurisdiction,
      });
      setHardenedResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setHardening(false);
    }
  };

  const handleExportDocx = async () => {
    const textToExport = hardenedResult?.hardened_text || sourceText;
    if (!textToExport || exportingDocx) return;
    setExportingDocx(true);
    try {
      await contractsApi.downloadDocx(
        token,
        {
          title: `${title} — Hardened Edition`,
          fullText: textToExport,
          jurisdiction,
          counselNotes: hardenedResult?.resolutions_applied || [],
          disclaimer: hardenedResult?.disclaimer || "",
        },
        `${title}_hardened`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingDocx(false);
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectedCount = (auditResult?.loopholes || []).filter((lp) => selectedIds[lp.loophole_id]).length;

  return (
    <div className="draft-studio-grid">
      <section className="surface-card draft-config-panel">
        <div className="section-head-row">
          <span className="section-eyebrow"><ShieldAlertIcon size={13} /> Initial Draft Input (Section 4a)</span>
          {activeDraftText && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setSourceText(activeDraftText); setTitle(activeDraftTitle || "Current Draft"); }}
            >
              Load Active Draft
            </button>
          )}
        </div>
        <p className="muted-caption">
          Identifies legal loopholes, undefined terminologies, unassigned variables, subjective phrasing, broken cross-references,
          and silent edge cases—hardening the manuscript strictly without altering commercial pricing or deal structure.
        </p>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="hd-title" className="field-label">Draft Title</label>
          <input id="hd-title" className="text-input input-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {contracts.length > 0 && (
          <div className="field">
            <label htmlFor="hd-ws" className="field-label">Or Import From Workspace</label>
            <select id="hd-ws" className="select-input" defaultValue="" onChange={(e) => loadFromWorkspace(e.target.value)}>
              <option value="">Select an analyzed contract...</option>
              {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="hd-text" className="field-label">Initial Draft Manuscript</label>
          <textarea
            id="hd-text"
            className="text-input textarea-input"
            rows={14}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Paste your initial agreement draft here to detect undefined terms, unassigned parameters, ambiguous timelines, and exploitable legal loopholes..."
          />
        </div>

        <button type="button" className="btn btn-primary btn-full" onClick={handleAudit} disabled={auditing || sourceText.trim().length < 30}>
          <ShieldAlertIcon size={15} /> {auditing ? "Auditing Vulnerabilities & Terminologies..." : "Scan Draft for Loopholes & Vulnerabilities"}
        </button>
      </section>

      <section className="draft-preview-column">
        {error && <div className="alert alert-error">{error}</div>}

        {auditing ? (
          <div className="surface-card paper-canvas-empty">
            <div className="spinner" />
            <h3>Running Surgical Vulnerability Audit</h3>
            <p>Checking capitalized terms against definitions, cross-references, subjective phrasing, missing enforcement triggers, and statutory hazards...</p>
          </div>
        ) : !auditResult ? (
          <div className="surface-card paper-canvas-empty">
            <span className="dropzone-icon-wrap"><ShieldAlertIcon size={22} /></span>
            <h3>Vulnerabilities &amp; Surgical Resolutions</h3>
            <p>
              Unlike a general commercial review, this workspace focuses exclusively on legal tightness: sealing undefined terms,
              unassigned variables, ambiguous phrasing, and silent edge cases while keeping your commercial deal intact.
            </p>
          </div>
        ) : (
          <div className="draft-output-stack">
            <section className="surface-card settings-card">
              <div className="section-head-row">
                <div>
                  <span className="section-eyebrow">Draft Tightness Assessment</span>
                  <p className="muted-caption">
                    Loophole Score: <strong>{auditResult.scorecard?.loophole_score ?? 0}/100</strong> ·
                    Health: <strong>{auditResult.scorecard?.overall_health ?? 0}/100</strong> →
                    Projected: <strong>{auditResult.scorecard?.projected_health_after_fixes ?? 92}/100</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleSealLoopholes(null)}
                  disabled={hardening || selectedCount === 0}
                >
                  <ShieldCheckIcon size={14} /> {hardening ? "Sealing Loopholes..." : `Seal Selected (${selectedCount})`}
                </button>
              </div>
              <p className="summary-prose" style={{ marginTop: 8 }}>{auditResult.executive_assessment}</p>
              {auditResult.unassigned_terms?.length > 0 && (
                <div className="section-pills-row" style={{ marginTop: 8 }}>
                  <span className="mono-caption">Unassigned / Undefined:</span>
                  {auditResult.unassigned_terms.map((t, i) => <span key={i} className="mono-tag">{t}</span>)}
                </div>
              )}
            </section>

            {hardenedResult && (
              <section className="surface-card paper-canvas">
                <div className="paper-canvas-toolbar">
                  <div className="paper-canvas-meta">
                    <span className="risk-pill risk-low">
                      HARDENED · {hardenedResult.post_hardening_scorecard?.loophole_score ?? 95}/100 TIGHTNESS
                    </span>
                    <span className="mono-caption">{hardenedResult.resolutions_applied?.length || 0} loopholes sealed</span>
                  </div>
                  <div className="paper-canvas-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(hardenedResult.hardened_text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      }}
                    >
                      {copied ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportDocx} disabled={exportingDocx}>
                      <DownloadIcon size={13} /> {exportingDocx ? "..." : ".docx"}
                    </button>
                    {onApplyHardenedToStudio && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onApplyHardenedToStudio(hardenedResult.title || title, hardenedResult.hardened_text)}
                      >
                        <CheckCircleIcon size={13} /> Load in Draft Studio
                      </button>
                    )}
                  </div>
                </div>
                <div className="paper-canvas-body">
                  {hardenedResult.resolutions_applied?.length > 0 && (
                    <div className="brief-card" style={{ marginBottom: 12 }}>
                      <span className="brief-card-label">Surgical Resolutions Applied (Commercial Deal Preserved)</span>
                      <ul className="clean-list">
                        {hardenedResult.resolutions_applied.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                  <pre className="paper-manuscript" style={{ maxHeight: 420, overflow: "auto" }}>{hardenedResult.hardened_text}</pre>
                </div>
              </section>
            )}

            <div className="clause-list">
              {(auditResult.loopholes || []).map((lp) => {
                const sev = (lp.severity || "medium").toLowerCase();
                const tone = sev === "critical" || sev === "high" ? "high" : sev === "medium" ? "medium" : "low";
                return (
                  <article key={lp.loophole_id} className={`surface-card clause-item border-risk-${tone}`}>
                    <div className="clause-item-head">
                      <label className="checkbox-row" style={{ gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedIds[lp.loophole_id])}
                          onChange={() => toggleSelect(lp.loophole_id)}
                        />
                        <span className="clause-category">{lp.title}</span>
                      </label>
                      <div className="clause-head-right">
                        <span className="mono-caption">{CATEGORY_LABELS[lp.category] || lp.category}</span>
                        <span className={`risk-pill risk-${tone}`}>{sev.toUpperCase()}</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleSealLoopholes(lp)}
                          disabled={hardening}
                        >
                          Apply Fix
                        </button>
                      </div>
                    </div>
                    {lp.quoted_excerpt && <p className="clause-quote">&ldquo;{lp.quoted_excerpt}&rdquo;</p>}
                    <p className="clause-rationale"><AlertTriangleIcon size={12} /> <strong>What Could Go Wrong:</strong> {lp.what_could_go_wrong}</p>
                    <div className="remediation-note" style={{ marginTop: 6 }}>
                      <strong>Surgical Resolution:</strong> {lp.corrective_measure}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
