import { useEffect, useState } from "react";
import { contractsApi, playbookApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { AlertTriangleIcon, CheckCircleIcon, PlusIcon, ShieldCheckIcon, SparklesIcon, TrashIcon } from "../components/Icons";

const RULE_LABELS = {
  require_clause: "Require Clause Category",
  forbidden_keyword: "Flag Restricted Keywords",
  min_notice_days: "Minimum Notice Period (Days)",
  allowed_jurisdiction: "Allowed Governing Law",
  max_high_risk: "Max High-Risk Clauses",
};

const EMPTY_RULE = { name: "", ruleType: "require_clause", target: "", severity: "high", guidance: "" };

export default function Playbook() {
  const { token } = useAuth();
  const [playbook, setPlaybook] = useState(null);
  const [presets, setPresets] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [banner, setBanner] = useState(null);
  const [draft, setDraft] = useState(EMPTY_RULE);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([playbookApi.get(token), contractsApi.list(token), playbookApi.presets(token).catch(() => ({ presets: [] }))])
      .then(([pbRes, listRes, presetRes]) => {
        if (!active) return;
        setPlaybook(pbRes.playbook);
        setPresets(presetRes.presets || []);
        const done = (listRes.contracts || []).filter((c) => c.status === "completed");
        setContracts(done);
        if (done.length) setSelectedId(done[0]._id);
      })
      .catch((err) => active && setBanner({ tone: "error", text: err.message }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const saveRules = async (rules) => {
    if (!playbook) return;
    setPlaybook((p) => ({ ...p, rules }));
    setSaving(true);
    setBanner(null);
    try {
      const res = await playbookApi.update(token, { name: playbook.name, description: playbook.description, rules });
      setPlaybook(res.playbook);
      setBanner({ tone: "success", text: "Legal playbook rules saved." });
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (presetId) => {
    setSaving(true);
    setBanner(null);
    setEvaluation(null);
    try {
      const res = await playbookApi.applyPreset(token, presetId);
      setPlaybook(res.playbook);
      setBanner({ tone: "success", text: res.message });
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.target.trim()) return;
    const next = [...(playbook?.rules || []), { ...draft, enabled: true }];
    setDraft(EMPTY_RULE);
    await saveRules(next);
  };

  const evaluate = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setEvaluating(true);
    setBanner(null);
    try {
      setEvaluation(await playbookApi.evaluate(token, selectedId));
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setEvaluating(false);
    }
  };

  if (loading) return <div className="surface-card state-box"><div className="spinner" /><p>Loading legal playbook...</p></div>;

  return (
    <div className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Legal Playbook &amp; Compliance</h1>
          <p className="page-description">Load jurisdiction rule packs or define custom approval standards to audit agreements automatically.</p>
        </div>
      </div>

      {banner && <div className={`alert alert-${banner.tone}`}>{banner.text}</div>}

      {presets.length > 0 && (
        <section className="surface-card settings-card">
          <div className="section-head-row">
            <span className="section-eyebrow">Jurisdiction-Specific Legal Rule Packs</span>
            <span className="mono-caption">One-click templates</span>
          </div>
          <div className="infra-grid">
            {presets.map((p) => (
              <div key={p.id} className="infra-stat">
                <strong>{p.label}</strong>
                <span className="mono-caption">{p.jurisdiction} · {p.ruleCount} rules</span>
                <p className="muted-caption" style={{ fontSize: 12, marginTop: 4 }}>{p.description}</p>
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: "auto" }} disabled={saving} onClick={() => applyPreset(p.id)}>
                  Load Pack
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <span className="section-eyebrow"><ShieldCheckIcon size={14} /> Run Playbook Compliance Check</span>
          {evaluation && (
            <span className={`risk-pill ${evaluation.compliance_score >= 80 ? "risk-low" : evaluation.compliance_score >= 50 ? "risk-medium" : "risk-high"}`}>
              {evaluation.compliance_score}% COMPLIANT
            </span>
          )}
        </div>
        {contracts.length === 0 ? (
          <p className="muted-caption">Analyze at least one contract to run playbook compliance checks.</p>
        ) : (
          <form onSubmit={evaluate} className="search-strip-form">
            <select className="select-input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={evaluating}>
              {contracts.map((c) => <option key={c._id} value={c._id}>{c.title || c.fileName}</option>)}
            </select>
            <button type="submit" className="btn btn-primary" disabled={evaluating}>
              <SparklesIcon size={15} /> {evaluating ? "Evaluating..." : "Evaluate Contract"}
            </button>
          </form>
        )}

        {evaluation && (
          <div className="playbook-results">
            <div className="mono-caption">
              {evaluation.summary?.passed || 0} passed · {evaluation.summary?.warned || 0} warnings · {evaluation.summary?.failed || 0} failed
            </div>
            <div className="session-list">
              {(evaluation.results || []).map((r) => (
                <div key={r.ruleId} className="session-row">
                  <div className="session-info">
                    <div className="session-title-line">
                      {r.status === "pass"
                        ? <CheckCircleIcon size={15} className="text-accent" />
                        : <AlertTriangleIcon size={15} className={r.status === "fail" ? "text-danger" : "text-warn"} />}
                      <strong>{r.name}</strong>
                    </div>
                    <span className="muted-caption">{r.detail}</span>
                  </div>
                  <span className={`risk-pill ${r.status === "pass" ? "risk-low" : r.status === "warn" ? "risk-medium" : "risk-high"}`}>
                    {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow">Active Playbook Rules ({playbook?.rules?.length || 0})</span>
            <p className="muted-caption">{playbook?.description}</p>
          </div>
          <span className="mono-tag">{playbook?.name}</span>
        </div>
        <div className="session-list">
          {(playbook?.rules || []).map((rule, idx) => (
            <div key={rule._id || idx} className="session-row">
              <div className="session-info">
                <div className="session-title-line">
                  <input
                    type="checkbox"
                    checked={rule.enabled !== false}
                    aria-label={`Toggle ${rule.name}`}
                    onChange={() => saveRules(playbook.rules.map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r)))}
                  />
                  <strong>{rule.name}</strong>
                  <span className={`risk-pill risk-${rule.severity || "high"}`}>{(rule.severity || "high").toUpperCase()}</span>
                </div>
                <span className="mono-caption">{RULE_LABELS[rule.ruleType] || rule.ruleType}: {rule.target}</span>
                {rule.guidance && <span className="muted-caption">Guidance: {rule.guidance}</span>}
              </div>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                disabled={saving}
                aria-label={`Remove ${rule.name}`}
                onClick={() => saveRules(playbook.rules.filter((_, i) => i !== idx))}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card settings-card">
        <span className="section-eyebrow">Add Custom Playbook Rule</span>
        <form onSubmit={addRule} className="settings-form">
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="rule-name" className="field-label">Rule name</label>
              <input id="rule-name" className="text-input" placeholder="e.g., Approved Governing Law" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label htmlFor="rule-type" className="field-label">Check type</label>
              <select id="rule-type" className="select-input" value={draft.ruleType} onChange={(e) => setDraft((d) => ({ ...d, ruleType: e.target.value }))}>
                {Object.entries(RULE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rule-target" className="field-label">Target value</label>
              <input id="rule-target" className="text-input" placeholder="e.g., Delaware, California, Karnataka" value={draft.target} onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))} required />
            </div>
            <div className="field">
              <label htmlFor="rule-sev" className="field-label">Severity</label>
              <select id="rule-sev" className="select-input" value={draft.severity} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="rule-guidance" className="field-label">
              Negotiation fallback guidance <span className="field-optional">(used by AI redline generator)</span>
            </label>
            <input id="rule-guidance" className="text-input" placeholder="e.g., Propose mutual Delaware jurisdiction or neutral arbitration." value={draft.guidance} onChange={(e) => setDraft((d) => ({ ...d, guidance: e.target.value }))} />
          </div>
          <div className="form-footer-row">
            <button type="submit" className="btn btn-primary" disabled={saving}><PlusIcon size={15} /> {saving ? "Saving..." : "Add Rule"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
