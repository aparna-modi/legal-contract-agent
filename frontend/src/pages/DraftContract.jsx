import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { baselinesApi, clauseBankApi, contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import BaselineStudioPanel from "../components/BaselineStudioPanel";
import DraftHardeningPanel from "../components/DraftHardeningPanel";
import {
  AlertTriangleIcon, BookmarkIcon, CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon,
  FileTextIcon, HistoryIcon, LayersIcon, MicIcon, PenToolIcon, PrinterIcon, ScaleIcon,
  SendIcon, ShieldAlertIcon, ShieldCheckIcon,
} from "../components/Icons";
import { ExpandableSection, PageReveal } from "../components/Motion";
import { EASE_EDITORIAL, SPRING_SNAPPY } from "../components/motionTokens";

const FALLBACK_TEMPLATES = [
  { id: "msa", label: "Master Services Agreement (MSA)", category: "Commercial", description: "Enterprise B2B services framework with SOWs, acceptance criteria, IP separation, liability cap, and exit handover.", default_term: "12 months from Effective Date", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "deliverables_scope", label: "Core Services / Deliverables", placeholder: "e.g., Cloud architecture & managed support" }, { key: "liability_cap", label: "Liability Cap Target", placeholder: "e.g., 12 months fees or INR 50,00,000" }] },
  { id: "nda", label: "Non-Disclosure Agreement (NDA)", category: "Confidentiality", description: "Confidentiality deed protecting trade secrets, source code, pricing, and deal negotiations.", default_term: "3 years from Effective Date", default_notice: "15 days prior written notice", dynamic_fields: [{ key: "nda_direction", label: "Disclosure Structure", placeholder: "Mutual or Unilateral" }, { key: "survival_years", label: "Survival Period", placeholder: "5 years (indefinite for trade secrets)" }] },
  { id: "saas", label: "SaaS Subscription Agreement", category: "Technology", description: "Cloud subscription covering uptime SLA, service credits, DPDP/GDPR security, billing caps, and exit data export.", default_term: "12 months (non-evergreen)", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "uptime_sla", label: "Uptime SLA & Credits", placeholder: "99.9% uptime with 10% credits" }, { key: "data_residency", label: "Data Residency & Seats", placeholder: "AWS Mumbai, 250 users" }] },
  { id: "dpa", label: "Data Processing Agreement (DPA)", category: "Privacy & Compliance", description: "DPDP Act 2023 & GDPR-aligned processor obligations, 72-hour breach reporting, and exit deletion.", default_term: "Co-terminous with Master Agreement", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "breach_window", label: "Breach Reporting Window", placeholder: "Within 48–72 hours" }, { key: "data_categories", label: "Data Categories", placeholder: "Customer KYC, billing, logs" }] },
  { id: "employment", label: "Employment Agreement", category: "HR & Talent", description: "Full-time employment terms covering compensation, probation, IP ownership (Sec. 17), confidentiality, and exit.", default_term: "Continuing until terminated", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "designation", label: "Role & Location", placeholder: "Principal Engineer — Bengaluru" }, { key: "probation_period", label: "Probation & Leave", placeholder: "3 months probation; 24 days leave" }] },
  { id: "contractor", label: "Independent Contractor Agreement", category: "Commercial", description: "Consulting contract with milestones, conditional IP transfer upon payment, change orders, and kill fee.", default_term: "6 months or completion of milestones", default_notice: "14 days prior written notice", dynamic_fields: [{ key: "milestones", label: "Milestones & Acceptance", placeholder: "30% advance, 70% upon UAT" }, { key: "kill_fee", label: "Kill Fee", placeholder: "25% of remaining fees" }] },
  { id: "lease", label: "Commercial Lease Agreement", category: "Real Estate", description: "Premises lease covering rent escalation cap, security deposit, lock-in period, and peaceful handover.", default_term: "24 months from Commencement Date", default_notice: "60 days prior written notice", dynamic_fields: [{ key: "premises_address", label: "Demised Premises", placeholder: "3,200 sq. ft., Indiranagar, Bengaluru" }, { key: "security_deposit", label: "Deposit & Lock-In", placeholder: "6 months deposit; 12-month lock-in" }] },
  { id: "sale_agreement", label: "Property Sale Agreement (Agreement to Sell)", category: "Real Estate", description: "Indian property conveyance aligned with ToPA 1882, RERA 2016, 1% TDS (Sec. 194-IA), and Schedule A/B.", default_term: "90 days to Sale Deed Registration", default_notice: "15 days written cure notice", dynamic_fields: [{ key: "property_schedule", label: "Property Schedule & Area", placeholder: "Flat 402, 1,850 sq. ft., Khata A" }, { key: "consideration_split", label: "Consideration & Advance", placeholder: "INR 1,45,00,000; 20% advance" }] },
  { id: "founders", label: "Founders & Shareholders Agreement (SHA)", category: "Corporate & Equity", description: "Equity split, 4-year vesting + 1-year cliff, IP assignment, ROFR, drag/tag-along, and reserved matters.", default_term: "Continuing while Parties hold Equity", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "equity_vesting", label: "Equity & Vesting", placeholder: "50/50 split; 4yr vesting, 1yr cliff" }, { key: "reserved_matters", label: "Reserved Matters", placeholder: "New shares, debt > INR 25L, M&A" }] },
  { id: "software_dev", label: "Software Development & Escrow Agreement", category: "Technology", description: "Custom engineering contract with sprint milestones, UAT acceptance, source code transfer, and defect warranty.", default_term: "9 months + 90-day warranty", default_notice: "30 days prior written notice", dynamic_fields: [{ key: "tech_stack_escrow", label: "Repository Handover", placeholder: "Weekly Git commits & full docs" }, { key: "warranty_period", label: "Defect Warranty", placeholder: "90 days post-launch warranty" }] },
  { id: "partnership", label: "Partnership / Joint Venture Agreement", category: "Corporate & Equity", description: "Indian Partnership Act 1932 deed covering capital contribution, profit/loss ratio, banking authority, and buyout.", default_term: "5-year Joint Venture Term", default_notice: "60 days prior written notice", dynamic_fields: [{ key: "capital_profit", label: "Capital & Profit Share", placeholder: "INR 20L each; 50:50 ratio" }, { key: "buyout_valuation", label: "Exit Valuation", placeholder: "Independent CA fair market valuation" }] },
  { id: "settlement", label: "Settlement & Mutual Release Agreement", category: "Dispute Resolution", description: "Binding dispute closure with payment installments, full & final release, and withdrawal of proceedings.", default_term: "Effective upon cleared settlement sum", default_notice: "7 days cure notice on default", dynamic_fields: [{ key: "dispute_ref", label: "Underlying Dispute", placeholder: "Invoices #104-109 under 2025 MSA" }, { key: "settlement_sum", label: "Settlement Amount", placeholder: "INR 18,50,000 in two tranches" }] },
];

const JURISDICTIONS = [
  "India (Indian Contract Act, 1872)",
  "State of Delaware, USA",
  "State of California, USA",
  "England and Wales, United Kingdom",
  "Republic of Singapore",
  "European Union / Germany",
];

const STANCE_MODES = [
  { id: "protect_user_only", label: "Protect Only My Side", desc: "Maximum enforceable protection strictly for your party" },
  { id: "user_favorable", label: "User-Favorable", desc: "Strong commercial protection designed for smooth negotiation" },
  { id: "balanced", label: "Balanced Standard", desc: "Symmetrical reciprocal allocation for both parties" },
];

const REVISION_SUGGESTIONS = [
  "Cap our aggregate liability at 6 months of fees with mutual consequential damages exclusion",
  "Add a 72-hour data breach notice requirement under DPDP Act 2023 and certified deletion on exit",
  "Require formal 15-Business-Day written UAT acceptance before final milestone payment",
];

function formatDateToday() {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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
  <style>body{font-family:Georgia,serif;color:#14181f;max-width:760px;margin:40px auto;padding:0 28px;line-height:1.72;font-size:13px}
  h1{font-size:21px;text-align:center;text-transform:uppercase;border-bottom:1.5px solid #182230;padding-bottom:10px;margin-bottom:20px}
  pre{font-family:Georgia,serif;white-space:pre-wrap;word-break:break-word;margin:0}
  .note{font-family:system-ui,sans-serif;font-size:11px;color:#5c6473;border-top:1px solid #e4e1d8;margin-top:28px;padding-top:10px}</style></head>
  <body><h1>${esc(title)}</h1><pre>${esc(text)}</pre>
  <p class="note">Contract drafting work product prepared for review and counsel sign-off prior to execution.</p>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

function simpleLineDiff(prevText = "", currText = "") {
  const prevLines = new Set(String(prevText).split("\n").map((l) => l.trim()).filter(Boolean));
  const currLines = String(currText).split("\n");
  return currLines.map((line, idx) => ({
    idx,
    text: line,
    changed: line.trim().length > 0 && !prevLines.has(line.trim()),
  }));
}

export default function DraftContract() {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [studioMode, setStudioMode] = useState("draft"); // "draft" | "harden" | "baselines"
  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  const [selectedType, setSelectedType] = useState("msa");
  const [stance, setStance] = useState("protect_user_only");
  const [representingParty, setRepresentingParty] = useState("party_a");
  const [templateDetails, setTemplateDetails] = useState({});
  const [form, setForm] = useState({
    title: "",
    party_a: "",
    party_b: "",
    jurisdiction: JURISDICTIONS[0],
    effective_date: formatDateToday(),
    term_duration: FALLBACK_TEMPLATES[0].default_term,
    payment_terms: "Invoices payable within thirty (30) calendar days of receipt, exclusive of applicable GST.",
    notice_period: FALLBACK_TEMPLATES[0].default_notice,
    special_instructions: "",
  });

  const [generating, setGenerating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [revisionLog, setRevisionLog] = useState([]);
  const [versions, setVersions] = useState([]);
  const [showVersionDiff, setShowVersionDiff] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [placeholderValues, setPlaceholderValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [shareTeam, setShareTeam] = useState(false);
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState(false);
  const [clauseBank, setClauseBank] = useState([]);
  const [showClauseBank, setShowClauseBank] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([
      contractsApi.draftTemplates(token).catch(() => null),
      clauseBankApi.list(token).catch(() => null),
    ]).then(([tplRes, cbRes]) => {
      if (!active) return;
      if (Array.isArray(tplRes?.templates) && tplRes.templates.length) setTemplates(tplRes.templates);
      if (Array.isArray(cbRes?.clauses)) setClauseBank(cbRes.clauses);
    });
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
    setTemplateDetails({});
    setForm((prev) => ({
      ...prev,
      term_duration: tpl.default_term || prev.term_duration,
      notice_period: tpl.default_notice || prev.notice_period,
    }));
  };

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const startVoiceDictation = (targetField) => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setBanner({ tone: "error", text: "Voice dictation is not supported in this browser; please enter instructions directly." });
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "en-IN";
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript || "";
      if (!spoken) return;
      if (targetField === "revision") setRevisionPrompt((p) => (p ? `${p} ${spoken}` : spoken));
      else updateField("special_instructions", form.special_instructions ? `${form.special_instructions} ${spoken}` : spoken);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setBanner(null);
    setRevisionLog([]);
    setPlaceholderValues({});
    setShowVersionDiff(false);
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
        stance,
        representingParty: stance === "balanced" ? "mutual" : representingParty,
        templateDetails,
      });
      setDraft(data);
      setVersions([{ version: "v1", label: "Initial Counsel Draft", text: data.full_text, createdAt: new Date().toLocaleTimeString() }]);
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
      const updatedText = res.full_text || draft.full_text;
      setDraft((prev) => ({
        ...prev,
        title: res.title || prev.title,
        full_text: updatedText,
        sections_included: res.sections_included?.length ? res.sections_included : prev.sections_included,
        negotiation_notes: res.negotiation_notes?.length ? res.negotiation_notes : prev.negotiation_notes,
        placeholders_to_confirm: res.placeholders_to_confirm?.length ? res.placeholders_to_confirm : prev.placeholders_to_confirm,
        presentation_baseline: res.presentation_baseline || prev.presentation_baseline,
        draft_strength_score: res.draft_strength_score ?? prev.draft_strength_score,
        provider: res.provider || prev.provider,
      }));
      setVersions((prev) => [
        ...prev,
        { version: `v${prev.length + 1}`, label: inst.slice(0, 48), text: updatedText, createdAt: new Date().toLocaleTimeString() },
      ]);
      if (res.changes_made?.length) {
        setRevisionLog((prev) => [{ instruction: inst, changes: res.changes_made }, ...prev].slice(0, 5));
      }
      setRevisionPrompt("");
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setRevising(false);
    }
  };

  const insertClauseFromBank = (clause) => {
    if (!draft?.full_text) {
      updateField("special_instructions", `${form.special_instructions}\nInclude ${clause.title}: ${clause.text}`.trim());
      setBanner({ tone: "success", text: `Added "${clause.title}" to drafting instructions.` });
      return;
    }
    const block = `\n\n${clause.title.toUpperCase()}\n${clause.text}`;
    const idxSig = draft.full_text.search(/\n\s*IN WITNESS WHEREOF\b/i);
    const nextText = idxSig !== -1
      ? draft.full_text.slice(0, idxSig) + block + "\n" + draft.full_text.slice(idxSig)
      : draft.full_text + block;
    setDraft((prev) => ({ ...prev, full_text: nextText }));
    setVersions((prev) => [...prev, { version: `v${prev.length + 1}`, label: `Inserted: ${clause.title}`, text: nextText, createdAt: new Date().toLocaleTimeString() }]);
    setBanner({ tone: "success", text: `Inserted "${clause.title}" into manuscript.` });
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
      setBanner({ tone: "success", text: `Applied ${count} parameter value${count === 1 ? "" : "s"} across the manuscript.` });
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

  const handleExportDocx = async () => {
    if (!draft?.full_text || exportingDocx) return;
    setExportingDocx(true);
    setBanner(null);
    try {
      await contractsApi.downloadDocx(
        token,
        {
          title: draft.title || activeTemplate?.label || "Commercial Agreement",
          fullText: draft.full_text,
          subtitle: stance === "protect_user_only" ? "Protective Counsel Draft" : "Commercial Agreement",
          jurisdiction: draft.jurisdiction || form.jurisdiction,
          counselNotes: [
            ...(draft.negotiation_notes || []),
            ...(draft.counsel_annotations || []).map((a) => `${a.section}: ${a.why_drafted_this_way}`),
          ],
          disclaimer: draft.disclaimer || "",
        },
        draft.title || selectedType
      );
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setExportingDocx(false);
    }
  };

  const handleDownloadMd = () => {
    if (!draft?.full_text) return;
    const mdLines = [`# ${draft.title || "Contract Draft"}`, "", draft.full_text];
    if (draft.negotiation_notes?.length) mdLines.push("", "## Counsel Negotiation Notes", ...draft.negotiation_notes.map((n) => `- ${n}`));
    downloadMarkdownFile(draft.title || selectedType, mdLines.join("\n"));
  };

  const handleSaveAsBaseline = async () => {
    if (!draft?.full_text || savingBaseline) return;
    setSavingBaseline(true);
    setBanner(null);
    try {
      await baselinesApi.save(token, {
        name: `${draft.title || activeTemplate?.label} — Firm Baseline`,
        contractType: selectedType,
        jurisdiction: draft.jurisdiction || form.jurisdiction,
        stance,
        version: `v${versions.length || 1}.0`,
        fullText: draft.full_text,
        sections: draft.sections_included || [],
        presentationScore: draft.presentation_baseline?.presentation_score || 95,
      });
      setBanner({ tone: "success", text: "Saved manuscript to Gold-Standard Baselines (Section 4b)." });
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setSavingBaseline(false);
    }
  };

  const handleSaveToWorkspace = async () => {
    if (!draft?.full_text || saving) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await contractsApi.saveDraft(token, {
        title: draft.title || form.title || "Drafted Commercial Agreement",
        fullText: draft.full_text,
        autoAnalyze: true,
        visibility: shareTeam && user?.organizationId ? "team" : "private",
        userPartyName: representingParty === "party_a" ? form.party_a : (representingParty === "party_b" ? form.party_b : ""),
      });
      setBanner({ tone: "success", text: res.message || "Agreement saved and analyzed in your workspace." });
      setTimeout(() => navigate("/"), 750);
    } catch (err) {
      setBanner({ tone: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const activeTemplate = templates.find((t) => t.id === selectedType) || templates[0];
  const prevVersionText = versions.length >= 2 ? versions[versions.length - 2].text : "";

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <span className="section-eyebrow"><ScaleIcon size={13} /> Senior Counsel Drafting Suite</span>
          <h1 className="page-heading">Draft, Harden &amp; Standardize Agreements</h1>
          <p className="page-description">
            Author execution-ready agreements across 12 legal templates, surgically seal loopholes in initial drafts (4a), and standardize publication baselines (4b).
          </p>
        </div>
        <div className="page-header-actions">
          <div className="segmented-control" role="tablist" aria-label="Drafting workflow mode">
            <button type="button" role="tab" aria-selected={studioMode === "draft"} className={`seg-btn ${studioMode === "draft" ? "active" : ""}`} onClick={() => setStudioMode("draft")}>
              <PenToolIcon size={13} /> Draft New
            </button>
            <button type="button" role="tab" aria-selected={studioMode === "harden"} className={`seg-btn ${studioMode === "harden" ? "active" : ""}`} onClick={() => setStudioMode("harden")}>
              <ShieldAlertIcon size={13} /> Vulnerabilities &amp; Fixes (4a)
            </button>
            <button type="button" role="tab" aria-selected={studioMode === "baselines"} className={`seg-btn ${studioMode === "baselines" ? "active" : ""}`} onClick={() => setStudioMode("baselines")}>
              <LayersIcon size={13} /> Baselines &amp; Format (4b)
            </button>
          </div>
        </div>
      </div>

      {banner && <div className={`alert alert-${banner.tone}`} role="status">{banner.text}</div>}

      {studioMode === "harden" ? (
        <DraftHardeningPanel
          token={token}
          activeDraftText={draft?.full_text || ""}
          activeDraftTitle={draft?.title || form.title || ""}
          jurisdiction={draft?.jurisdiction || form.jurisdiction}
          onApplyHardenedToStudio={(newTitle, newText) => {
            setDraft((prev) => ({
              ...(prev || { contract_type: selectedType, jurisdiction: form.jurisdiction }),
              title: newTitle,
              full_text: newText,
            }));
            setVersions((prev) => [...prev, { version: `v${prev.length + 1}`, label: "Hardened Pass (4a)", text: newText, createdAt: new Date().toLocaleTimeString() }]);
            setStudioMode("draft");
            setBanner({ tone: "success", text: "Loaded hardened manuscript into the Drafting Studio." });
          }}
        />
      ) : studioMode === "baselines" ? (
        <BaselineStudioPanel
          token={token}
          activeDraftText={draft?.full_text || ""}
          activeDraftTitle={draft?.title || form.title || ""}
          jurisdiction={draft?.jurisdiction || form.jurisdiction}
          contractType={selectedType}
          onLoadBaselineToDraft={(bTitle, bText) => {
            setDraft({ title: bTitle, full_text: bText, contract_type: selectedType, jurisdiction: form.jurisdiction });
            setVersions([{ version: "v1", label: "Loaded Baseline", text: bText, createdAt: new Date().toLocaleTimeString() }]);
            setStudioMode("draft");
            setBanner({ tone: "success", text: `Loaded "${bTitle}" into the Drafting Studio.` });
          }}
        />
      ) : (
        <div className="draft-studio-grid">
          <form onSubmit={handleGenerate} className="surface-card draft-config-panel">
            <div className="section-head-row">
              <span className="section-eyebrow">1. Agreement Template</span>
              <span className="mono-caption">{templates.length} practice templates</span>
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
                      <span className="mono-tag">{tpl.category || tpl.id.toUpperCase()}</span>
                    </div>
                    <p>{tpl.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="draft-divider" />
            <span className="section-eyebrow">2. Client Representation &amp; Posture</span>

            <div className="segmented-control" style={{ marginTop: 4 }}>
              {STANCE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`seg-btn ${stance === m.id ? "active" : ""}`}
                  onClick={() => setStance(m.id)}
                  disabled={generating}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="muted-caption">{STANCE_MODES.find((m) => m.id === stance)?.desc}</p>

            {stance !== "balanced" && (
              <div className="field">
                <label className="field-label">Representing Side</label>
                <div className="segmented-control">
                  <button type="button" className={`seg-btn ${representingParty === "party_a" ? "active" : ""}`} onClick={() => setRepresentingParty("party_a")}>
                    First Party ({form.party_a || "Party A"})
                  </button>
                  <button type="button" className={`seg-btn ${representingParty === "party_b" ? "active" : ""}`} onClick={() => setRepresentingParty("party_b")}>
                    Second Party ({form.party_b || "Party B"})
                  </button>
                </div>
              </div>
            )}

            <div className="draft-divider" />
            <span className="section-eyebrow">3. Parties &amp; Commercial Schedule</span>

            <div className="field">
              <label htmlFor="draft-title" className="field-label">Agreement Title <span className="field-optional">(optional)</span></label>
              <input id="draft-title" className="text-input" value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder={activeTemplate?.label || "Master Services Agreement"} disabled={generating} />
            </div>

            <div className="draft-two-col">
              <div className="field">
                <label htmlFor="draft-party-a" className="field-label">First Party</label>
                <input id="draft-party-a" className="text-input" value={form.party_a} onChange={(e) => updateField("party_a", e.target.value)} placeholder="e.g., Horizon Labs Pvt. Ltd." disabled={generating} />
              </div>
              <div className="field">
                <label htmlFor="draft-party-b" className="field-label">Second Party</label>
                <input id="draft-party-b" className="text-input" value={form.party_b} onChange={(e) => updateField("party_b", e.target.value)} placeholder="e.g., Meridian Systems Inc." disabled={generating} />
              </div>
            </div>

            <div className="draft-two-col">
              <div className="field">
                <label htmlFor="draft-jurisdiction" className="field-label">Governing Law</label>
                <select id="draft-jurisdiction" className="select-input" value={form.jurisdiction} onChange={(e) => updateField("jurisdiction", e.target.value)} disabled={generating}>
                  {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="draft-effective" className="field-label">Effective Date</label>
                <input id="draft-effective" className="text-input" value={form.effective_date} onChange={(e) => updateField("effective_date", e.target.value)} disabled={generating} />
              </div>
            </div>

            <div className="draft-two-col">
              <div className="field">
                <label htmlFor="draft-term" className="field-label">Term / Duration</label>
                <input id="draft-term" className="text-input" value={form.term_duration} onChange={(e) => updateField("term_duration", e.target.value)} disabled={generating} />
              </div>
              <div className="field">
                <label htmlFor="draft-notice" className="field-label">Termination Notice</label>
                <input id="draft-notice" className="text-input" value={form.notice_period} onChange={(e) => updateField("notice_period", e.target.value)} disabled={generating} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="draft-payment" className="field-label">Payment &amp; Tax Terms</label>
              <input id="draft-payment" className="text-input" value={form.payment_terms} onChange={(e) => updateField("payment_terms", e.target.value)} disabled={generating} />
            </div>

            {activeTemplate?.dynamic_fields?.length > 0 && (
              <div className="draft-two-col">
                {activeTemplate.dynamic_fields.map((df) => (
                  <div key={df.key} className="field">
                    <label className="field-label">{df.label}</label>
                    <input
                      className="text-input input-sm"
                      value={templateDetails[df.key] || ""}
                      onChange={(e) => setTemplateDetails((prev) => ({ ...prev, [df.key]: e.target.value }))}
                      placeholder={df.placeholder}
                      disabled={generating}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="field">
              <div className="section-head-row">
                <label htmlFor="draft-special" className="field-label">Special Covenants &amp; Drafting Directives</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => startVoiceDictation("special")} disabled={generating}>
                  <MicIcon size={13} /> {listening ? "Listening..." : "Dictate"}
                </button>
              </div>
              <textarea
                id="draft-special"
                className="text-input textarea-input"
                rows={3}
                value={form.special_instructions}
                onChange={(e) => updateField("special_instructions", e.target.value)}
                placeholder="e.g., Strict 15-day UAT acceptance, Bengaluru arbitration seat, 2x IP indemnity super-cap..."
                disabled={generating}
              />
            </div>

            <div className="form-footer-row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClauseBank((v) => !v)}>
                <BookmarkIcon size={14} /> Clause Bank ({clauseBank.length})
              </button>
              <button type="submit" className="btn btn-primary btn-full" disabled={generating}>
                <PenToolIcon size={15} /> {generating ? "Drafting Counsel-Grade Agreement..." : "Generate Execution-Ready Draft"}
              </button>
            </div>

            {showClauseBank && clauseBank.length > 0 && (
              <div className="drafted-missing-box" style={{ marginTop: 10 }}>
                <span className="section-eyebrow">Approved Clause Bank — Click to Insert</span>
                <div className="session-list" style={{ marginTop: 6 }}>
                  {clauseBank.map((cb) => (
                    <div key={cb._id} className="session-row">
                      <div className="session-info">
                        <strong>{cb.title}</strong>
                        <span className="muted-caption">{cb.clauseType} · {cb.jurisdiction}</span>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => insertClauseFromBank(cb)}>Insert</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>

          <section className="draft-preview-column" aria-live="polite">
            {generating ? (
              <div className="surface-card paper-canvas-empty">
                <div className="spinner" />
                <h3>Drafting {activeTemplate?.label}</h3>
                <p>Structuring formal Recitals, Definitions, hierarchical operative Articles, Schedules, Witness Blocks, and running automated loophole verification...</p>
              </div>
            ) : !draft ? (
              <div className="surface-card paper-canvas-empty">
                <span className="dropzone-icon-wrap"><FileTextIcon size={22} /></span>
                <h3>Execution-Ready Manuscript Canvas</h3>
                <p>
                  Configure your template, represented party, and commercial schedule on the left. Manuscripts include formal Recitals,
                  Definitions, hierarchical sub-clauses, Schedules, Counsel Clause Notes, automated loophole checks, and styled Microsoft Word (.docx) export.
                </p>
                <div className="draft-empty-checklist">
                  <span><CheckCircleIcon size={14} /> 12 commercial &amp; Indian conveyance templates</span>
                  <span><CheckCircleIcon size={14} /> Protect-Only-My-Side posture with enforceability checks</span>
                  <span><CheckCircleIcon size={14} /> Word (.docx), PDF export, Version Diff &amp; Section 4a/4b studios</span>
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
                      {draft.draft_strength_score != null && (
                        <span className={`risk-pill ${draft.draft_strength_score >= 80 ? "risk-low" : "risk-medium"}`}>
                          STRENGTH {draft.draft_strength_score}/100
                        </span>
                      )}
                      {draft.presentation_baseline?.presentation_score != null && (
                        <span className="mono-tag">BASELINE {draft.presentation_baseline.presentation_score}%</span>
                      )}
                    </div>
                    <div className="paper-canvas-actions">
                      <div className="segmented-control">
                        <button type="button" className={`seg-btn ${!editMode && !showVersionDiff ? "active" : ""}`} onClick={() => { setEditMode(false); setShowVersionDiff(false); }}>Preview</button>
                        <button type="button" className={`seg-btn ${editMode ? "active" : ""}`} onClick={() => { setEditMode(true); setShowVersionDiff(false); }}>Edit</button>
                        {versions.length >= 2 && (
                          <button type="button" className={`seg-btn ${showVersionDiff ? "active" : ""}`} onClick={() => { setShowVersionDiff(true); setEditMode(false); }}>
                            Diff
                          </button>
                        )}
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                        {copied ? <><CheckIcon size={14} className="text-accent" /> Copied</> : <><CopyIcon size={14} /> Copy</>}
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportDocx} disabled={exportingDocx}>
                        <DownloadIcon size={14} /> {exportingDocx ? "..." : ".docx"}
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => printManuscript(draft.title, draft.full_text)}>
                        <PrinterIcon size={14} /> PDF
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownloadMd}>.md</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveAsBaseline} disabled={savingBaseline} title="Save as Firm Baseline (4b)">
                        <BookmarkIcon size={14} /> {savingBaseline ? "..." : "Baseline"}
                      </button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveToWorkspace} disabled={saving}>
                        <ShieldCheckIcon size={14} /> {saving ? "Saving..." : "Save & Analyze"}
                      </button>
                    </div>
                  </div>

                  {versions.length > 1 && (
                    <div className="version-strip">
                      <span className="mono-caption"><HistoryIcon size={12} /> Revisions:</span>
                      {versions.map((v, i) => (
                        <button
                          key={v.version}
                          type="button"
                          className={`chip-btn ${i === versions.length - 1 ? "chip-active" : ""}`}
                          onClick={() => setDraft((prev) => ({ ...prev, full_text: v.text }))}
                          title={`Restore ${v.version}: ${v.label}`}
                        >
                          {v.version} · {v.label.slice(0, 22)}
                        </button>
                      ))}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStudioMode("harden")}>
                        Run 4a Hardening →
                      </button>
                    </div>
                  )}

                  {user?.organizationId && (
                    <label className="checkbox-row" style={{ padding: "6px 24px 0" }}>
                      <input type="checkbox" checked={shareTeam} onChange={(e) => setShareTeam(e.target.checked)} disabled={saving} />
                      <span>Share saved agreement with {user.organization}</span>
                    </label>
                  )}

                  <div className="paper-canvas-body">
                    <div className="paper-document-header">
                      <span className="section-eyebrow">Execution Manuscript · {draft.jurisdiction}</span>
                      <h2 className="paper-document-title">{draft.title}</h2>
                    </div>

                    {draft.sections_included?.length > 0 && (
                      <div className="section-pills-row">
                        {draft.sections_included.map((sec, i) => <span key={i} className="mono-tag">{sec}</span>)}
                      </div>
                    )}

                    {editMode ? (
                      <textarea
                        className="paper-manuscript paper-manuscript-editor"
                        value={draft.full_text}
                        onChange={(e) => setDraft((prev) => ({ ...prev, full_text: e.target.value }))}
                        rows={24}
                        aria-label="Edit contract manuscript"
                      />
                    ) : showVersionDiff && prevVersionText ? (
                      <div className="paper-manuscript" style={{ maxHeight: 540, overflow: "auto" }}>
                        {simpleLineDiff(prevVersionText, draft.full_text).map((ln) => (
                          <div key={ln.idx} className={ln.changed ? "diff-add" : ""} style={{ display: "block", padding: "1px 4px" }}>
                            {ln.text || "\u00A0"}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="paper-manuscript">{draft.full_text}</pre>
                    )}
                  </div>

                  <div className="draft-revise-bar">
                    <div className="section-head-row">
                      <span className="section-eyebrow">Directive-Based Manuscript Revision</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => startVoiceDictation("revision")} disabled={revising}>
                        <MicIcon size={13} /> Dictate Edit
                      </button>
                    </div>
                    <form className="qa-form" onSubmit={(e) => { e.preventDefault(); handleRevise(); }}>
                      <input
                        type="text"
                        className="text-input"
                        value={revisionPrompt}
                        onChange={(e) => setRevisionPrompt(e.target.value)}
                        placeholder="Direct an edit (e.g., 'Add a 60-day source code escrow covenant and seat arbitration in Bengaluru')"
                        disabled={revising}
                      />
                      <button type="submit" className="btn btn-primary" disabled={revising || revisionPrompt.trim().length < 5}>
                        <SendIcon size={14} /> {revising ? "Applying..." : "Apply Revision"}
                      </button>
                    </form>
                    <div className="prompt-chips">
                      {REVISION_SUGGESTIONS.map((s) => (
                        <button key={s} type="button" className="chip-btn" onClick={() => handleRevise(s)} disabled={revising}>{s}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {draft.counsel_annotations?.length > 0 && (
                  <section className="surface-card settings-card">
                    <span className="section-eyebrow"><ScaleIcon size={13} /> Counsel&apos;s Clause Annotations</span>
                    <div className="clause-list" style={{ marginTop: 8 }}>
                      {draft.counsel_annotations.map((ann, idx) => (
                        <div key={idx} className="brief-card">
                          <div className="section-head-row">
                            <strong>{ann.section}</strong>
                            {ann.statutory_hook && <span className="law-ref-pill">{ann.statutory_hook}</span>}
                          </div>
                          <p className="clause-explanation-text" style={{ marginTop: 4 }}>{ann.why_drafted_this_way}</p>
                          {ann.expected_pushback && (
                            <p className="muted-caption" style={{ marginTop: 4 }}><strong>Expected Pushback:</strong> {ann.expected_pushback}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <AnimatePresence>
                  {revisionLog.length > 0 && (
                    <ExpandableSection>
                      <section className="surface-card settings-card">
                        <span className="section-eyebrow">Revision Audit Trail</span>
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
                        <span className="section-eyebrow">Unassigned Parameter Quick-Fill ({detectedPlaceholders.length})</span>
                        <p className="muted-caption">Populate bracketed fields across every occurrence in the manuscript.</p>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={applyPlaceholders} disabled={!Object.values(placeholderValues).some((v) => v.trim())}>
                        Apply Across Manuscript
                      </button>
                    </div>
                    <div className="draft-two-col">
                      {detectedPlaceholders.map((ph) => (
                        <div key={ph} className="field">
                          <label className="mono-caption">{ph}</label>
                          <input
                            type="text"
                            className="text-input input-sm"
                            placeholder={`Enter value for ${ph}`}
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
                        <span className="section-eyebrow">Pre-Circulation Negotiation Notes</span>
                        <ul className="clean-list">
                          {draft.negotiation_notes.map((note, idx) => <li key={idx}>{note}</li>)}
                        </ul>
                      </section>
                    )}
                    {draft.placeholders_to_confirm?.length > 0 && (
                      <section className="surface-card settings-card">
                        <span className="section-eyebrow"><AlertTriangleIcon size={13} /> Items to Confirm Before Execution</span>
                        <ul className="clean-list">
                          {draft.placeholders_to_confirm.map((item, idx) => <li key={idx}>{item}</li>)}
                        </ul>
                      </section>
                    )}
                  </div>
                )}

                <p className="legal-disclaimer">
                  Work product prepared for counsel review and commercial negotiation — verify with qualified counsel before execution.
                </p>
              </motion.div>
            )}
          </section>
        </div>
      )}
    </PageReveal>
  );
}
