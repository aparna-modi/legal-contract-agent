import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { contractsApi, playbookApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { AlertTriangleIcon, CheckCircleIcon, PlusIcon, ScaleIcon, ShieldCheckIcon, TrashIcon } from "../components/Icons";
import { ExpandableSection, PageReveal, StaggerContainer, StaggerItem } from "../components/Motion";

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

  // Natural-language policy rule generator
  const [policyText, setPolicyText] = useState("");
  const [policyJurisdiction, setPolicyJurisdiction] = useState("India / General Commercial");
  const [generatingRules, setGeneratingRules] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState(null);

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

  const handleGenerateRules = async (e) => {
    e.preventDefault();
    if (policyText.trim().length < 10 || generatingRules) return;
    setGeneratingRules(true);
    setBanner(null);
    try {
      const res = await playbookApi.generateRules(token, {
        policyText: policyText.trim(),
        jurisdiction: policyJurisdiction.trim(),
      });
      setGeneratedPreview(res);
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setGeneratingRules(false);
    }
  };

  const appendGeneratedRules = async (rulesToAdd) => {
    if (!rulesToAdd?.length) return;
    const next = [...(playbook?.rules || []), ...rulesToAdd.map((r) => ({ ...r, enabled: true }))];
    setGeneratedPreview(null);
    setPolicyText("");
    await saveRules(next);
  };

  const evaluate = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setEvaluating(true);
    setBanner(null);
    try {
      setEvaluation(await playbookApi.evaluate(token, selectedId, { useAiAudit: true }));
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setEvaluating(false);
    }
  };

  if (loading) return <div className="surface-card state-box"><div className="spinner" /><p>Loading legal playbook...</p></div>;

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Legal Playbook &amp; Compliance</h1>
          <p className="page-description">Load jurisdiction rule packs, generate rules from plain-English policy guidelines, and run hybrid AI compliance audits.</p>
        </div>
      </div>

      {banner && <div className={`alert alert-${banner.tone}`}>{banner.text}</div>}

      {presets.length > 0 && (
        <section className="surface-card settings-card">
          <div className="section-head-row">
            <span className="section-eyebrow">Jurisdiction-Specific Rule Packs</span>
            <span className="mono-caption">One-click baseline standards</span>
          </div>
          <StaggerContainer className="preset-grid" stagger={0.04}>
            {presets.map((p) => (
              <StaggerItem key={p.id} className="preset-card">
                <div className="section-head-row">
                  <strong>{p.label}</strong>
                  <span className="mono-tag">{p.ruleCount} rules</span>
                </div>
                <span className="mono-caption">{p.jurisdiction}</span>
                <p className="muted-caption">{p.description}</p>
                <div className="preset-card-foot">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => applyPreset(p.id)}>
                    Load Rule Pack
                  </button>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </section>
      )}

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <span className="section-eyebrow"><ShieldCheckIcon size={14} /> Run Hybrid AI Compliance Audit</span>
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
              <ShieldCheckIcon size={15} /> {evaluating ? "Auditing..." : "Evaluate Contract"}
            </button>
          </form>
        )}

        {evaluation && (
          <div className="playbook-results">
            <div className="mono-caption">
              {evaluation.summary?.passed || 0} passed · {evaluation.summary?.warned || 0} warnings · {evaluation.summary?.failed || 0} failed
              {evaluation.provider && ` · ${evaluation.provider}`}
            </div>
            {evaluation.ai_audit_summary && (
              <div className="brief-card">
                <span className="brief-card-label">Executive Compliance Assessment</span>
                <p className="summary-prose">{evaluation.ai_audit_summary}</p>
              </div>
            )}
            <div className="session-list">
              {(evaluation.results || []).map((r) => (
                <div key={r.ruleId} className="session-row">
                  <div className="session-info">
                    <div className="session-title-line">
                      {r.status === "pass"
                        ? <CheckCircleIcon size={15} className="text-accent" />
                        : <AlertTriangleIcon size={15} className={r.status === "fail" ? "text-danger" : "text-warn"} />}
                      <strong>{r.name}</strong>
                      {r.aiVerified && <span className="mono-tag">AI Verified</span>}
                    </div>
                    <span className="muted-caption">{r.detail}</span>
                    {r.status !== "pass" && r.remediation && (
                      <div className="remediation-note">
                        <strong>Recommended remediation:</strong> {r.remediation}
                      </div>
                    )}
                  </div>
                  <span className={`risk-pill ${r.status === "pass" ? "risk-low" : r.status === "warn" ? "risk-medium" : "risk-high"}`}>
                    {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
            <p className="legal-disclaimer">Automated playbook checks flag potential rule deviations for review — not legal advice.</p>
          </div>
        )}
      </section>

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow"><ScaleIcon size={14} /> Generate Rules from Policy Text</span>
            <p className="muted-caption">Paste internal procurement or legal guidelines in plain English to create structured playbook checks automatically.</p>
          </div>
        </div>
        <form onSubmit={handleGenerateRules} className="settings-form">
          <div className="field">
            <label htmlFor="policy-text" className="field-label">Company policy or review guidelines</label>
            <textarea
              id="policy-text"
              className="text-input textarea-input"
              rows={3}
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              placeholder="e.g., Every vendor agreement must include a Limitation of Liability cap and Confidentiality clause, give at least 30 days termination notice, forbid unlimited liability or silent auto-renewal, and be governed by Indian or Delaware law."
              disabled={generatingRules}
            />
          </div>
          <div className="settings-form-foot">
            <input
              className="text-input input-sm"
              style={{ maxWidth: 280 }}
              value={policyJurisdiction}
              onChange={(e) => setPolicyJurisdiction(e.target.value)}
              placeholder="Jurisdiction context"
              aria-label="Jurisdiction context"
              disabled={generatingRules}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={generatingRules || policyText.trim().length < 10}>
              {generatingRules ? "Generating rules..." : "Generate Structured Rules"}
            </button>
          </div>
        </form>

        <AnimatePresence>
          {generatedPreview?.rules?.length > 0 && (
            <ExpandableSection className="drafted-missing-box">
              <div className="section-head-row">
                <div>
                  <span className="section-eyebrow">Proposed Rules ({generatedPreview.rules.length})</span>
                  {generatedPreview.summary && <p className="muted-caption">{generatedPreview.summary}</p>}
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGeneratedPreview(null)}>Dismiss</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => appendGeneratedRules(generatedPreview.rules)} disabled={saving}>
                    <PlusIcon size={14} /> Add All to Playbook
                  </button>
                </div>
              </div>
              <div className="session-list">
                {generatedPreview.rules.map((r, i) => (
                  <div key={i} className="session-row">
                    <div className="session-info">
                      <div className="session-title-line">
                        <strong>{r.name}</strong>
                        <span className={`risk-pill risk-${r.severity || "medium"}`}>{(r.severity || "medium").toUpperCase()}</span>
                      </div>
                      <span className="mono-caption">{RULE_LABELS[r.ruleType] || r.ruleType}: {r.target}</span>
                      {r.guidance && <span className="muted-caption">{r.guidance}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ExpandableSection>
          )}
        </AnimatePresence>
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
    </PageReveal>
  );
}
