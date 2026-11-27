import { useEffect, useState } from "react";
import { baselinesApi, contractsApi } from "../api/client";
import { BookmarkIcon, CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon, LayersIcon, TrashIcon } from "./Icons";

export default function BaselineStudioPanel({
  token,
  activeDraftText = "",
  activeDraftTitle = "",
  jurisdiction = "India (Indian Contract Act, 1872)",
  contractType = "msa",
  onLoadBaselineToDraft,
}) {
  const [title, setTitle] = useState(activeDraftTitle || "Commercial Agreement Baseline");
  const [sourceText, setSourceText] = useState(activeDraftText || "");
  const [baselines, setBaselines] = useState([]);
  const [contracts, setContracts] = useState([]);

  const [standardizing, setStandardizing] = useState(false);
  const [stdResult, setStdResult] = useState(null);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [baselineVersion, setBaselineVersion] = useState("v1.0");
  const [exportingDocx, setExportingDocx] = useState(false);

  const [selectedBaselineId, setSelectedBaselineId] = useState("");
  const [benchmarkTargetId, setBenchmarkTargetId] = useState("");
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkRes, setBenchmarkRes] = useState(null);

  const [copied, setCopied] = useState(false);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState(null);

  const loadBaselines = () => {
    if (!token) return;
    baselinesApi.list(token)
      .then((res) => {
        const list = res.baselines || [];
        setBaselines(list);
        if (list.length && !selectedBaselineId) setSelectedBaselineId(list[0]._id);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadBaselines();
    if (!token) return;
    contractsApi.list(token)
      .then((res) => {
        const done = (res.contracts || []).filter((c) => c.status === "completed");
        setContracts(done);
        if (done.length) setBenchmarkTargetId(done[0]._id);
      })
      .catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStandardize = async () => {
    if (sourceText.trim().length < 50) return setError("Provide at least 50 characters of draft text to standardize presentation.");
    setStandardizing(true);
    setError(null);
    setBanner(null);
    try {
      const res = await contractsApi.standardizeBaseline(token, {
        title: title.trim() || "Standardized Agreement",
        draftText: sourceText,
        jurisdiction,
        contractType,
      });
      setStdResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setStandardizing(false);
    }
  };

  const handleSaveBaseline = async () => {
    const bodyText = stdResult?.standardized_text || sourceText;
    if (bodyText.trim().length < 50) return setError("Standardize or enter a complete agreement before saving as a Baseline.");
    setSavingBaseline(true);
    setError(null);
    try {
      await baselinesApi.save(token, {
        name: (stdResult?.title || title || "Firm Contract Baseline").trim(),
        contractType,
        jurisdiction,
        version: baselineVersion.trim() || "v1.0",
        fullText: bodyText,
        sections: stdResult?.sections_included || [],
        presentationScore: stdResult?.after_baseline?.presentation_score || 92,
      });
      setBanner("Saved to your firm's Gold-Standard Baseline Library.");
      loadBaselines();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingBaseline(false);
    }
  };

  const handleDeleteBaseline = async (id) => {
    try {
      await baselinesApi.remove(token, id);
      loadBaselines();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBenchmark = async () => {
    if (!selectedBaselineId) return;
    setBenchmarking(true);
    setError(null);
    try {
      const payload = benchmarkTargetId
        ? { contractId: benchmarkTargetId }
        : { targetTitle: title || "Current Draft", targetText: stdResult?.standardized_text || sourceText };
      const res = await baselinesApi.benchmark(token, selectedBaselineId, payload);
      setBenchmarkRes(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBenchmarking(false);
    }
  };

  const handleExportDocx = async (docTitle, docText) => {
    if (!docText || exportingDocx) return;
    setExportingDocx(true);
    try {
      await contractsApi.downloadDocx(
        token,
        {
          title: docTitle || "Baseline Agreement",
          fullText: docText,
          subtitle: "Gold-Standard Presentation Baseline",
          jurisdiction,
          counselNotes: stdResult?.formatting_upgrades || [],
        },
        `${docTitle || "baseline"}_formatted`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingDocx(false);
    }
  };

  return (
    <div className="draft-studio-grid">
      <section className="surface-card draft-config-panel">
        <div className="section-head-row">
          <span className="section-eyebrow"><LayersIcon size={13} /> Presentation Standardization (Section 4b)</span>
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
          Converts raw or inconsistently structured drafts into an authoritative law-firm Presentation Baseline—complete with
          Title Block, Recitals, Definitions, hierarchical numbering, Schedules, and 2-Witness execution blocks.
        </p>

        <div className="draft-two-col" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="bl-title" className="field-label">Baseline Title</label>
            <input id="bl-title" className="text-input input-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bl-ver" className="field-label">Version Tag</label>
            <input id="bl-ver" className="text-input input-sm" value={baselineVersion} onChange={(e) => setBaselineVersion(e.target.value)} placeholder="v1.0" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="bl-text" className="field-label">Source Draft to Format &amp; Standardize</label>
          <textarea
            id="bl-text"
            className="text-input textarea-input"
            rows={11}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Paste rough terms or load your draft to transform into a standardized executive Presentation Baseline..."
          />
        </div>

        <div className="form-footer-row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary btn-full" onClick={handleStandardize} disabled={standardizing || sourceText.trim().length < 50}>
            <LayersIcon size={14} /> {standardizing ? "Formatting to Baseline Standard..." : "Standardize Presentation Baseline"}
          </button>
        </div>

        <div className="draft-divider" />
        <span className="section-eyebrow">Saved &amp; Curated Firm Baselines ({baselines.length})</span>
        <div className="session-list" style={{ marginTop: 8 }}>
          {baselines.map((b) => (
            <div key={b._id} className="session-row">
              <div className="session-info">
                <div className="session-title-line">
                  <strong>{b.name}</strong>
                  <span className="mono-tag">{b.version || "v1.0"}</span>
                  {b.isCurated && <span className="mono-tag">Gold Standard</span>}
                </div>
                <span className="muted-caption">{b.jurisdiction} · {b.presentationScore || 95}% presentation conformity</span>
              </div>
              <div className="clause-head-right">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setTitle(b.name);
                    setSourceText(b.fullText);
                    onLoadBaselineToDraft?.(b.name, b.fullText);
                  }}
                >
                  Use
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleExportDocx(b.name, b.fullText)}
                  disabled={exportingDocx}
                  title="Download Word (.docx)"
                >
                  <DownloadIcon size={13} />
                </button>
                {!b.isCurated && (
                  <button type="button" className="icon-btn icon-btn-danger" onClick={() => handleDeleteBaseline(b._id)} aria-label="Delete baseline">
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="draft-preview-column">
        {error && <div className="alert alert-error">{error}</div>}
        {banner && <div className="alert alert-success">{banner}</div>}

        {stdResult && (
          <div className="surface-card paper-canvas">
            <div className="paper-canvas-toolbar">
              <div className="paper-canvas-meta">
                <span className="risk-pill risk-low">
                  PRESENTATION {stdResult.before_baseline?.presentation_score ?? 0}% → {stdResult.after_baseline?.presentation_score ?? 100}%
                </span>
                <span className="mono-caption">{stdResult.after_baseline?.grade}</span>
              </div>
              <div className="paper-canvas-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(stdResult.standardized_text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportDocx(stdResult.title, stdResult.standardized_text)}
                  disabled={exportingDocx}
                >
                  <DownloadIcon size={13} /> {exportingDocx ? "..." : "Word (.docx)"}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveBaseline} disabled={savingBaseline}>
                  <BookmarkIcon size={13} /> {savingBaseline ? "Saving..." : "Save as Baseline"}
                </button>
              </div>
            </div>

            <div className="paper-canvas-body">
              <div className="brief-two-col" style={{ marginBottom: 14 }}>
                <div className="brief-card">
                  <span className="brief-card-label">10-Point Legal Presentation Checklist</span>
                  <div className="checklist-compact">
                    {(stdResult.after_baseline?.checklist || []).map((item, idx) => (
                      <div key={idx} className="checklist-row">
                        <CheckCircleIcon size={13} className={item.passed ? "text-accent" : "text-danger"} />
                        <span>{item.criterion}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {stdResult.formatting_upgrades?.length > 0 && (
                  <div className="brief-card">
                    <span className="brief-card-label">Structural Upgrades Applied</span>
                    <ul className="clean-list">
                      {stdResult.formatting_upgrades.map((u, idx) => <li key={idx}>{u}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <pre className="paper-manuscript" style={{ maxHeight: 420, overflow: "auto" }}>{stdResult.standardized_text}</pre>
            </div>
          </div>
        )}

        <section className="surface-card settings-card">
          <span className="section-eyebrow">Benchmark Contract Against a Baseline</span>
          <p className="muted-caption">
            Measure structural conformity, missing standard articles, and presentation discipline of any contract against your firm baseline.
          </p>
          <div className="draft-two-col" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="bm-base" className="field-label">Reference Baseline</label>
              <select id="bm-base" className="select-input" value={selectedBaselineId} onChange={(e) => setSelectedBaselineId(e.target.value)}>
                {baselines.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bm-target" className="field-label">Target Document</label>
              <select id="bm-target" className="select-input" value={benchmarkTargetId} onChange={(e) => setBenchmarkTargetId(e.target.value)}>
                <option value="">Current Draft in Editor Above</option>
                {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
              </select>
            </div>
          </div>
          <div className="form-footer-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleBenchmark} disabled={benchmarking || !selectedBaselineId}>
              {benchmarking ? "Benchmarking..." : "Run Baseline Conformity Benchmark"}
            </button>
          </div>

          {benchmarkRes && (
            <div className="drafted-missing-box" style={{ marginTop: 12 }}>
              <div className="section-head-row">
                <strong>{benchmarkRes.target_title} vs. {benchmarkRes.baseline_title}</strong>
                <span className={`risk-pill ${benchmarkRes.conformity_score >= 80 ? "risk-low" : benchmarkRes.conformity_score >= 60 ? "risk-medium" : "risk-high"}`}>
                  {benchmarkRes.conformity_score}% CONFORMITY
                </span>
              </div>
              <p className="muted-caption" style={{ marginTop: 4 }}>
                Section Coverage: {benchmarkRes.section_coverage_pct}% · Presentation Score: {benchmarkRes.target_presentation_score}%
              </p>
              <p className="summary-prose" style={{ marginTop: 6 }}>{benchmarkRes.recommendation}</p>
              {benchmarkRes.missing_baseline_sections?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className="mono-caption">Missing Baseline Sections:</span>
                  <div className="section-pills-row" style={{ marginTop: 4 }}>
                    {benchmarkRes.missing_baseline_sections.map((s, idx) => <span key={idx} className="risk-pill risk-medium">{s}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
