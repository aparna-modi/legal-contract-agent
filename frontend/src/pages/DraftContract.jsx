import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  PenToolIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "../components/Icons";
import { PageReveal } from "../components/Motion";
import { EASE_EDITORIAL, SPRING_SNAPPY } from "../components/motionTokens";

const FALLBACK_TEMPLATES = [
  {
    id: "msa",
    label: "Master Services Agreement (MSA)",
    description: "B2B services, SaaS, or consulting framework with SOWs, fees, IP ownership, liability cap, and termination.",
    default_term: "12 months from Effective Date",
    default_notice: "30 days prior written notice",
  },
  {
    id: "nda",
    label: "Mutual Non-Disclosure Agreement (NDA)",
    description: "Reciprocal confidentiality agreement protecting trade secrets, product roadmaps, and commercial terms.",
    default_term: "3 years from Effective Date",
    default_notice: "15 days prior written notice",
  },
  {
    id: "employment",
    label: "Employment Agreement",
    description: "Full-time employment terms covering role, compensation, probation, IP assignment, confidentiality, and exit.",
    default_term: "At-will / continuing until terminated",
    default_notice: "30 days prior written notice",
  },
  {
    id: "contractor",
    label: "Independent Contractor Agreement",
    description: "Freelance or consulting contract with deliverables, milestone invoices, conditional IP transfer, and kill fee.",
    default_term: "6 months or completion of deliverables",
    default_notice: "14 days prior written notice",
  },
  {
    id: "lease",
    label: "Commercial Lease Agreement",
    description: "Premises lease covering rent, security deposit, maintenance responsibilities, lock-in period, and handover.",
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
      .catch(() => {
        // Keep local template defaults if the catalog lookup fails.
      });
    return () => {
      active = false;
    };
  }, [token]);

  const selectTemplate = (tpl) => {
    setSelectedType(tpl.id);
    setForm((prev) => ({
      ...prev,
      term_duration: tpl.default_term || prev.term_duration,
      notice_period: tpl.default_notice || prev.notice_period,
    }));
  };

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setBanner(null);
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
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!draft?.full_text) return;
    try {
      await navigator.clipboard.writeText(draft.full_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted frames.
    }
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
          <h1 className="page-heading">Draft Balanced Agreements</h1>
          <p className="page-description">
            Generate structured, section-numbered commercial drafts tailored to your jurisdiction, then save straight into your workspace for risk review.
          </p>
        </div>
      </div>

      {banner && <div className={`alert alert-${banner.tone}`} role="status">{banner.text}</div>}

      <div className="draft-studio-grid">
        <form onSubmit={handleGenerate} className="surface-card draft-config-panel">
          <div className="section-head-row">
            <span className="section-eyebrow">1. Choose Agreement Template</span>
            <span className="mono-caption">{templates.length} templates</span>
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
                    <motion.span
                      layoutId="draft-tpl-indicator"
                      className="template-card-ring"
                      transition={SPRING_SNAPPY}
                    />
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
          <span className="section-eyebrow">2. Commercial Parameters</span>

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
              <label htmlFor="draft-party-a" className="field-label">First Party (Client / Discloser)</label>
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
              <label htmlFor="draft-party-b" className="field-label">Second Party (Vendor / Counterparty)</label>
              <input
                id="draft-party-b"
                className="text-input"
                value={form.party_b}
                onChange={(e) => updateField("party_b", e.target.value)}
                placeholder="e.g., Meridian Cloud Systems Inc."
                disabled={generating}
              />
            </div>
          </div>

          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="draft-jurisdiction" className="field-label">Governing Law / Jurisdiction</label>
              <select
                id="draft-jurisdiction"
                className="select-input"
                value={form.jurisdiction}
                onChange={(e) => updateField("jurisdiction", e.target.value)}
                disabled={generating}
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="draft-effective" className="field-label">Effective Date</label>
              <input
                id="draft-effective"
                className="text-input"
                value={form.effective_date}
                onChange={(e) => updateField("effective_date", e.target.value)}
                placeholder="e.g., May 1, 2026"
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
              <label htmlFor="draft-notice" className="field-label">Termination Notice Period</label>
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
              placeholder="e.g., INR 4,50,000 monthly retainer, Net-30 invoicing, 1% late fee cap"
              disabled={generating}
            />
          </div>

          <div className="field">
            <label htmlFor="draft-special" className="field-label">
              Special Clauses or Negotiation Guardrails <span className="field-optional">(optional)</span>
            </label>
            <textarea
              id="draft-special"
              className="text-input textarea-input"
              rows={3}
              value={form.special_instructions}
              onChange={(e) => updateField("special_instructions", e.target.value)}
              placeholder="e.g., Mutual liability cap at 12 months fees, no auto-renewal, data residency in Mumbai, 30-day breach cure period..."
              disabled={generating}
            />
          </div>

          <div className="form-footer-row">
            <button type="submit" className="btn btn-primary btn-full" disabled={generating}>
              <SparklesIcon size={15} /> {generating ? "Drafting structured agreement..." : "Generate Contract Draft"}
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
                Pick a template and fill in parties, jurisdiction, and payment terms. Every generated draft uses balanced mutual protections, flags bracketed fields to confirm, and can be saved directly into your Workspace for full clause risk triage and Q&amp;A.
              </p>
              <div className="draft-empty-checklist">
                <span><CheckCircleIcon size={14} /> Numbered sections &amp; signature blocks</span>
                <span><CheckCircleIcon size={14} /> Commercial negotiation notes</span>
                <span><CheckCircleIcon size={14} /> One-click save &amp; automated risk analysis</span>
              </div>
            </div>
          ) : (
            <motion.div
              key={draft.title + draft.provider}
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
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                      {copied ? <><CheckIcon size={14} className="text-accent" /> Copied</> : <><CopyIcon size={14} /> Copy</>}
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
                      <ShieldCheckIcon size={14} /> {saving ? "Saving & Analyzing..." : "Save & Analyze"}
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

                  <pre className="paper-manuscript">{draft.full_text}</pre>
                </div>
              </div>

              {(draft.negotiation_notes?.length > 0 || draft.placeholders_to_confirm?.length > 0) && (
                <div className="draft-notes-grid">
                  {draft.negotiation_notes?.length > 0 && (
                    <section className="surface-card settings-card">
                      <span className="section-eyebrow"><SparklesIcon size={13} /> Commercial Negotiation Notes</span>
                      <ul className="clean-list">
                        {draft.negotiation_notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {draft.placeholders_to_confirm?.length > 0 && (
                    <section className="surface-card settings-card">
                      <span className="section-eyebrow"><AlertTriangleIcon size={13} /> Confirm Before Signing</span>
                      <ul className="clean-list">
                        {draft.placeholders_to_confirm.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
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
