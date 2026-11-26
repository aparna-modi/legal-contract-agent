import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon,
  FileTextIcon, PenToolIcon, PrinterIcon, SendIcon, ShieldCheckIcon,
} from "../components/Icons";
import { ExpandableSection, PageReveal } from "../components/Motion";
import { EASE_EDITORIAL, SPRING_SNAPPY } from "../components/motionTokens";

const FALLBACK_TEMPLATES = [
  {
    id: "msa",
    label: "Master Services Agreement (MSA)",
    description: "B2B services framework with SOWs, fees, IP ownership, liability cap, and termination.",
    default_term: "12 months from Effective Date",
    default_notice: "30 days prior written notice",
  },
  {
    id: "nda",
    label: "Mutual Non-Disclosure Agreement (NDA)",
    description: "Reciprocal confidentiality protecting trade secrets, product roadmaps, and negotiations.",
    default_term: "3 years from Effective Date",
    default_notice: "15 days prior written notice",
  },
  {
    id: "saas",
    label: "SaaS Subscription Agreement",
    description: "Cloud software subscription covering uptime SLA, data security, billing, and exit export.",
    default_term: "12 months (non-evergreen)",
    default_notice: "30 days prior written notice",
  },
  {
    id: "dpa",
    label: "Data Processing Agreement (DPA)",
    description: "DPDP Act & GDPR-aligned processor duties, breach notice windows, and deletion on exit.",
    default_term: "Co-terminous with Master Agreement",
    default_notice: "30 days prior written notice",
  },
  {
    id: "employment",
    label: "Employment Agreement",
    description: "Full-time employment terms covering compensation, probation, IP, confidentiality, and exit.",
    default_term: "Continuing until terminated",
    default_notice: "30 days prior written notice",
  },
  {
    id: "contractor",
    label: "Independent Contractor Agreement",
    description: "Freelance or consulting contract with milestones, conditional IP transfer, and kill fee.",
    default_term: "6 months or completion of deliverables",
    default_notice: "14 days prior written notice",
  },
  {
    id: "lease",
    label: "Commercial Lease Agreement",
    description: "Premises lease covering rent, security deposit, maintenance, lock-in, and handover.",
    default_term: "24 months from Commencement Date",
    default_notice: "60 days prior written notice",
  },
];

const JURISDICTIONS = [
  "India (Indian Contract Act, 1872)",
  "State of Delaware, USA",
  "State of California, USA",
  "England and Wales, United Kingdom",
  "Republic of Singapore",
  "European Union / Germany",
];

const REVISION_SUGGESTIONS = [
  "Cap aggregate liability at 6 months of fees with mutual consequential damages waiver",
  "Add a 72-hour data breach notification obligation and data deletion on exit",
  "Remove any automatic renewal and require written renewal confirmation",
];

function formatDateToday() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function downloadMarkdownFile(filename, content) {
  const blob = new Blob([content], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(filename || "contract_draft").replace(/[^a-zA-Z0-9_-]+/g, "_")}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printManuscript(title, text) {
  const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const win = window.open("", "_blank", "width=880,height=780");
  if (!win) return;
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
  <style>body{font-family:Georgia,serif;color:#14181f;max-width:760px;margin:40px auto;padding:0 28px;line-height:1.7;font-size:13.5px}
  h1{font-size:22px;border-bottom:1px solid #d1cdc1;padding-bottom:10px;margin-bottom:18px}
  pre{font-family:Georgia,serif;white-space:pre-wrap;word-break:break-word;margin:0}
  .note{font-family:system-ui,sans-serif;font-size:11.5px;color:#5c6473;border-top:1px solid #e4e1d8;margin-top:28px;padding-top:10px}</style></head>
  <body><h1>${esc(title)}</h1><pre>${esc(text)}</pre>
  <p class="note">AI-assisted contract draft generated for informational starting-point use only — not legal advice. Have qualified counsel review before signing.</p>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

export default function DraftContract() {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  const [selectedType, setSelectedType] = useState("msa");
  const [form, setForm] = useState({
    title: "",
    party_a: "",
    party_b: "",
    jurisdiction: JURISDICTIONS[0],
    effective_date: formatDateToday(),
    term_duration: FALLBACK_TEMPLATES[0].default_term,
    payment_terms: "Invoices payable within thirty (30) calendar days of receipt.",
    notice_period: FALLBACK_TEMPLATES[0].default_notice,
    special_instructions: "",
  });

  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [revisionLog, setRevisionLog] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [placeholderValues, setPlaceholderValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [shareTeam, setShareTeam] = useState(false);
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    contractsApi
      .draftTemplates(token)
      .then((res) => {
        if (active && Array.isArray(res?.templates) && res.templates.length) {
          setTemplates(res.templates);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  const draftText = draft?.full_text || "";
  const detectedPlaceholders = useMemo(() => {
    if (!draftText) return [];
    const matches = draftText.match(/\[[A-Za-z0-9\s/.,'()-]{2,48}\]/g) || [];
    return Array.from(new Set(matches)).slice(0, 12);
  }, [draftText]);

  const selectTemplate = (tpl) => {
    setSelectedType(tpl.id);
    setForm((prev) => ({
      ...prev,
      term_duration: tpl.default_term || prev.term_duration,
      notice_period: tpl.default_notice || prev.notice_period,
    }));
  };

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setBanner(null);
    setRevisionLog([]);
    setPlaceholderValues({});
    try {
      const data = await contractsApi.draft(token, {
        contractType: selectedType,
        title: form.title,
        partyA: form.party_a,
        partyB: form.party_b,
        jurisdiction: form.jurisdiction,
        effectiveDate: form.effective_date,
        termDuration: form.term_duration,
        paymentTerms: form.payment_terms,
        noticePeriod: form.notice_period,
        specialInstructions: form.special_instructions,
      });
      setDraft(data);
      setEditMode(false);
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleRevise = async (instructionOverride) => {
    const inst = (instructionOverride ?? revisionPrompt).trim();
    if (!inst || !draft?.full_text || revising) return;
    setRevising(true);
    setBanner(null);
    try {
      const res = await contractsApi.reviseDraft(token, {
        title: draft.title,
        currentText: draft.full_text,
        instruction: inst,
        jurisdiction: draft.jurisdiction || form.jurisdiction,
      });
      setDraft((prev) => ({
        ...prev,
        title: res.title || prev.title,
        full_text: res.full_text || prev.full_text,
        sections_included: res.sections_included?.length ? res.sections_included : prev.sections_included,
        negotiation_notes: res.negotiation_notes?.length ? res.negotiation_notes : prev.negotiation_notes,
        placeholders_to_confirm: res.placeholders_to_confirm?.length ? res.placeholders_to_confirm : prev.placeholders_to_confirm,
        provider: res.provider || prev.provider,
      }));
      if (res.changes_made?.length) {
        setRevisionLog((prev) => [{ instruction: inst, changes: res.changes_made }, ...prev].slice(0, 4));
      }
      setRevisionPrompt("");
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setRevising(false);
    }
  };

  const applyPlaceholders = () => {
    if (!draft?.full_text) return;
    let updated = draft.full_text;
    let count = 0;
    Object.entries(placeholderValues).forEach(([tokenStr, replacement]) => {
      const clean = replacement.trim();
      if (clean) {
        updated = updated.split(tokenStr).join(clean);
        count += 1;
      }
    });
    if (count > 0) {
      setDraft((prev) => ({ ...prev, full_text: updated }));
      setPlaceholderValues({});
      setBanner({ tone: "success", text: `Applied ${count} placeholder value${count === 1 ? "" : "s"} across the manuscript.` });
    }
  };

  const handleCopy = async () => {
    if (!draft?.full_text) return;
    try {
      await navigator.clipboard.writeText(draft.full_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const handleDownloadMd = () => {
    if (!draft?.full_text) return;
    const mdLines = [
      `# ${draft.title || "Contract Draft"}`,
      "",
      `> ${draft.disclaimer || "AI-assisted contract draft for informational use only — not legal advice."}`,
      "",
      draft.full_text,
    ];
    if (draft.negotiation_notes?.length) {
      mdLines.push("", "## Commercial Negotiation Notes", ...draft.negotiation_notes.map((n) => `- ${n}`));
    }
    if (draft.placeholders_to_confirm?.length) {
      mdLines.push("", "## Placeholders to Confirm Before Signing", ...draft.placeholders_to_confirm.map((p) => `- ${p}`));
    }
    downloadMarkdownFile(draft.title || selectedType, mdLines.join("\n"));
  };

  const handleSaveToWorkspace = async () => {
    if (!draft?.full_text || saving) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await contractsApi.saveDraft(token, {
        title: draft.title || form.title || "AI Contract Draft",
        fullText: draft.full_text,
        autoAnalyze: true,
        visibility: shareTeam && user?.organizationId ? "team" : "private",
      });
      setBanner({
        tone: "success",
        text: res.message || "Draft saved and analyzed in your workspace. Opening Workspace...",
      });
      setTimeout(() => navigate("/"), 750);
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const activeTemplate = templates.find((t) => t.id === selectedType) || templates[0];

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <span className="section-eyebrow"><PenToolIcon size={13} /> Contract Drafting Studio</span>
          <h1 className="page-heading">Draft &amp; Refine Commercial Agreements</h1>
          <p className="page-description">
            Create clean contract drafts from 7 templates, ask for edits in plain English, fill blanks inline, and save to your workspace.
          </p>
        </div>
      </div>

      {banner && <div className={`alert alert-${banner.tone}`} role="status">{banner.text}</div>}

      <div className="draft-studio-grid">
        <form onSubmit={handleGenerate} className="surface-card draft-config-panel">
          <div className="section-head-row">
            <span className="section-eyebrow">1. Agreement Template</span>
            <span className="mono-caption">{templates.length} available</span>
          </div>

          <div className="template-grid" role="radiogroup" aria-label="Contract template">
            {templates.map((tpl) => {
              const selected = tpl.id === selectedType;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`template-card ${selected ? "selected" : ""}`}
                  onClick={() => selectTemplate(tpl)}
                  disabled={generating}
                >
                  {selected && (
                    <motion.span layoutId="draft-tpl-indicator" className="template-card-ring" transition={SPRING_SNAPPY} />
                  )}
                  <div className="template-card-head">
                    <strong>{tpl.label}</strong>
                    <span className="mono-tag">{tpl.id.toUpperCase()}</span>
                  </div>
                  <p>{tpl.description}</p>
                </button>
              );
            })}
          </div>

          <div className="draft-divider" />
          <span className="section-eyebrow">2. Commercial Terms</span>

          <div className="field">
            <label htmlFor="draft-title" className="field-label">
              Agreement Title <span className="field-optional">(optional)</span>
            </label>
            <input
              id="draft-title"
              className="text-input"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder={activeTemplate?.label || "Master Services Agreement"}
              disabled={generating}
            />
          </div>

          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="draft-party-a" className="field-label">First Party</label>
              <input
                id="draft-party-a"
                className="text-input"
                value={form.party_a}
                onChange={(e) => updateField("party_a", e.target.value)}
                placeholder="e.g., Horizon Labs Pvt. Ltd."
                disabled={generating}
              />
            </div>
            <div className="field">
              <label htmlFor="draft-party-b" className="field-label">Second Party</label>
              <input
                id="draft-party-b"
                className="text-input"
                value={form.party_b}
                onChange={(e) => updateField("party_b", e.target.value)}
                placeholder="e.g., Meridian Systems Inc."
                disabled={generating}
              />
            </div>
          </div>

          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="draft-jurisdiction" className="field-label">Governing Law</label>
              <select
                id="draft-jurisdiction"
                className="select-input"
                value={form.jurisdiction}
                onChange={(e) => updateField("jurisdiction", e.target.value)}
                disabled={generating}
              >
                {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="draft-effective" className="field-label">Effective Date</label>
              <input
                id="draft-effective"
                className="text-input"
                value={form.effective_date}
                onChange={(e) => updateField("effective_date", e.target.value)}
                disabled={generating}
              />
            </div>
          </div>

          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="draft-term" className="field-label">Term / Duration</label>
              <input
                id="draft-term"
                className="text-input"
                value={form.term_duration}
                onChange={(e) => updateField("term_duration", e.target.value)}
                disabled={generating}
              />
            </div>
            <div className="field">
              <label htmlFor="draft-notice" className="field-label">Termination Notice</label>
              <input
                id="draft-notice"
                className="text-input"
                value={form.notice_period}
                onChange={(e) => updateField("notice_period", e.target.value)}
                disabled={generating}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="draft-payment" className="field-label">Payment &amp; Commercial Terms</label>
            <input
              id="draft-payment"
              className="text-input"
              value={form.payment_terms}
              onChange={(e) => updateField("payment_terms", e.target.value)}
              disabled={generating}
            />
          </div>

          <div className="field">
            <label htmlFor="draft-special" className="field-label">
              Special Clauses or Guardrails <span className="field-optional">(optional)</span>
            </label>
            <textarea
              id="draft-special"
              className="text-input textarea-input"
              rows={3}
              value={form.special_instructions}
              onChange={(e) => updateField("special_instructions", e.target.value)}
              placeholder="e.g., Mutual liability cap at 12 months fees, no auto-renewal, Bengaluru arbitration seat..."
              disabled={generating}
            />
          </div>

          <div className="form-footer-row">
            <button type="submit" className="btn btn-primary btn-full" disabled={generating}>
              <PenToolIcon size={15} /> {generating ? "Drafting structured agreement..." : "Generate Contract Draft"}
            </button>
          </div>
        </form>

        <section className="draft-preview-column" aria-live="polite">
          {generating ? (
            <div className="surface-card paper-canvas-empty">
              <div className="spinner" />
              <h3>Drafting {activeTemplate?.label}</h3>
              <p>
                Structuring numbered clauses, mutual protections, governing-law provisions, and commercial review notes for {form.jurisdiction}...
              </p>
            </div>
          ) : !draft ? (
            <div className="surface-card paper-canvas-empty">
              <span className="dropzone-icon-wrap"><FileTextIcon size={22} /></span>
              <h3>Your manuscript appears here</h3>
              <p>
                Choose a template and enter commercial terms. Once generated, you can revise any clause via natural-language instructions, fill bracketed placeholders inline, or save directly into your workspace for full risk triage.
              </p>
              <div className="draft-empty-checklist">
                <span><CheckCircleIcon size={14} /> 7 commercial templates with numbered sections</span>
                <span><CheckCircleIcon size={14} /> Live AI clause revision &amp; placeholder quick-fill</span>
                <span><CheckCircleIcon size={14} /> One-click Save &amp; Risk Analysis in Workspace</span>
              </div>
            </div>
          ) : (
            <motion.div
              key={draft.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_EDITORIAL }}
              className="draft-output-stack"
            >
              <div className="surface-card paper-canvas">
                <div className="paper-canvas-toolbar">
                  <div className="paper-canvas-meta">
                    <span className="mono-tag">{(draft.contract_type || selectedType).toUpperCase()}</span>
                    <span className="mono-caption">{draft.jurisdiction}</span>
                    {draft.provider && <span className="mono-caption">· {draft.provider}</span>}
                  </div>
                  <div className="paper-canvas-actions">
                    <div className="segmented-control">
                      <button type="button" className={`seg-btn ${!editMode ? "active" : ""}`} onClick={() => setEditMode(false)}>Preview</button>
                      <button type="button" className={`seg-btn ${editMode ? "active" : ""}`} onClick={() => setEditMode(true)}>Edit</button>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                      {copied ? <><CheckIcon size={14} className="text-accent" /> Copied</> : <><CopyIcon size={14} /> Copy</>}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => printManuscript(draft.title, draft.full_text)}>
                      <PrinterIcon size={14} /> PDF
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownloadMd}>
                      <DownloadIcon size={14} /> .md
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveToWorkspace}
                      disabled={saving}
                    >
                      <ShieldCheckIcon size={14} /> {saving ? "Saving..." : "Save & Analyze"}
                    </button>
                  </div>
                </div>

                {user?.organizationId && (
                  <label className="checkbox-row" style={{ padding: "0 24px" }}>
                    <input
                      type="checkbox"
                      checked={shareTeam}
                      onChange={(e) => setShareTeam(e.target.checked)}
                      disabled={saving}
                    />
                    <span>Share saved draft with {user.organization}</span>
                  </label>
                )}

                <div className="paper-canvas-body">
                  <div className="paper-document-header">
                    <span className="section-eyebrow">Draft Agreement Manuscript</span>
                    <h2 className="paper-document-title">{draft.title}</h2>
                  </div>

                  {draft.sections_included?.length > 0 && (
                    <div className="section-pills-row">
                      {draft.sections_included.map((sec, i) => (
                        <span key={i} className="mono-tag">{sec}</span>
                      ))}
                    </div>
                  )}

                  {editMode ? (
                    <textarea
                      className="paper-manuscript paper-manuscript-editor"
                      value={draft.full_text}
                      onChange={(e) => setDraft((prev) => ({ ...prev, full_text: e.target.value }))}
                      rows={22}
                      aria-label="Edit contract manuscript"
                    />
                  ) : (
                    <pre className="paper-manuscript">{draft.full_text}</pre>
                  )}
                </div>

                <div className="draft-revise-bar">
                  <span className="section-eyebrow">Iterative AI Revision</span>
                  <form
                    className="qa-form"
                    onSubmit={(e) => { e.preventDefault(); handleRevise(); }}
                  >
                    <input
                      type="text"
                      className="text-input"
                      value={revisionPrompt}
                      onChange={(e) => setRevisionPrompt(e.target.value)}
                      placeholder="Instruct an edit (e.g., 'Add a 60-day source code escrow clause and make arbitration seated in Bengaluru')"
                      disabled={revising}
                    />
                    <button type="submit" className="btn btn-primary" disabled={revising || revisionPrompt.trim().length < 5}>
                      <SendIcon size={14} /> {revising ? "Revising..." : "Apply Revision"}
                    </button>
                  </form>
                  <div className="prompt-chips">
                    {REVISION_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleRevise(s)}
                        disabled={revising}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {revisionLog.length > 0 && (
                  <ExpandableSection>
                    <section className="surface-card settings-card">
                      <span className="section-eyebrow">Recent Revisions Applied</span>
                      <div className="session-list">
                        {revisionLog.map((rev, idx) => (
                          <div key={idx} className="brief-card">
                            <span className="brief-card-label">&ldquo;{rev.instruction}&rdquo;</span>
                            <ul className="clean-list">
                              {rev.changes.map((ch, cIdx) => <li key={cIdx}>{ch}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  </ExpandableSection>
                )}
              </AnimatePresence>

              {detectedPlaceholders.length > 0 && (
                <section className="surface-card settings-card">
                  <div className="section-head-row">
                    <div>
                      <span className="section-eyebrow">Inline Placeholder Quick-Fill ({detectedPlaceholders.length})</span>
                      <p className="muted-caption">Fill bracketed fields detected in your draft and replace them everywhere in one click.</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={applyPlaceholders}
                      disabled={!Object.values(placeholderValues).some((v) => v.trim())}
                    >
                      Apply to Manuscript
                    </button>
                  </div>
                  <div className="draft-two-col">
                    {detectedPlaceholders.map((ph) => (
                      <div key={ph} className="field">
                        <label className="mono-caption">{ph}</label>
                        <input
                          type="text"
                          className="text-input input-sm"
                          placeholder={`Replace ${ph}`}
                          value={placeholderValues[ph] || ""}
                          onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [ph]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(draft.negotiation_notes?.length > 0 || draft.placeholders_to_confirm?.length > 0) && (
                <div className="draft-notes-grid">
                  {draft.negotiation_notes?.length > 0 && (
                    <section className="surface-card settings-card">
                      <span className="section-eyebrow">Commercial Negotiation Notes</span>
                      <ul className="clean-list">
                        {draft.negotiation_notes.map((note, idx) => <li key={idx}>{note}</li>)}
                      </ul>
                    </section>
                  )}

                  {draft.placeholders_to_confirm?.length > 0 && (
                    <section className="surface-card settings-card">
                      <span className="section-eyebrow"><AlertTriangleIcon size={13} /> Confirm Before Signing</span>
                      <ul className="clean-list">
                        {draft.placeholders_to_confirm.map((item, idx) => <li key={idx}>{item}</li>)}
                      </ul>
                    </section>
                  )}
                </div>
              )}

              <p className="legal-disclaimer">
                {draft.disclaimer || "AI-assisted contract draft for informational starting-point use only — not legal advice. Consult a qualified attorney before signing."}
              </p>
            </motion.div>
          )}
        </section>
      </div>
    </PageReveal>
  );
}
