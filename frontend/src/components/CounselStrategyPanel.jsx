import { useState } from "react";
import { contractsApi } from "../api/client";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon, GavelIcon, MailIcon, MicIcon, ScaleIcon } from "./Icons";

const DISPUTE_PRESETS = [
  "Counterparty collected advance payment and failed to perform or deliver on schedule",
  "Unpaid approved invoices / cheque dishonoured after deliverables were accepted",
  "Unauthorized disclosure or misuse of confidential data, trade secrets, or source code",
  "Wrongful abrupt termination or arbitrary forfeiture of security deposit",
  "Title defect, undisclosed encumbrance, or delay in handing over physical possession",
];

export default function CounselStrategyPanel({ contract, token }) {
  const parties = contract.keyFacts?.parties || [];
  const [representedParty, setRepresentedParty] = useState(contract.userPartyName || parties[0] || "");
  const [posture, setPosture] = useState("claimant");
  const [disputeFacts, setDisputeFacts] = useState("");
  const [noticeType, setNoticeType] = useState("demand_and_cure");
  const [reliefSought, setReliefSought] = useState("");

  const [busy, setBusy] = useState(false);
  const [strategy, setStrategy] = useState(null);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [legalNotice, setLegalNotice] = useState(null);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [listening, setListening] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState(null);

  const startVoiceDictation = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setError("Voice dictation is not supported in this browser; please type the dispute facts directly.");
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "en-IN";
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || "";
      if (transcript) setDisputeFacts((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleAnalyzeStrategy = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await contractsApi.caseStrategy(token, contract._id, {
        representedParty: representedParty.trim(),
        userRole: contract.userRole || "client_buyer",
        posture,
        disputeFacts: disputeFacts.trim(),
        jurisdiction: contract.keyFacts?.governingLaw || "India",
      });
      setStrategy(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDraftNotice = async () => {
    setNoticeBusy(true);
    setError(null);
    try {
      const counterparty = parties.find((p) => p && p.toLowerCase() !== representedParty.trim().toLowerCase()) || parties[1] || "";
      const res = await contractsApi.legalNotice(token, contract._id, {
        representedParty: representedParty.trim(),
        counterpartyName: counterparty,
        disputeFacts: disputeFacts.trim(),
        reliefSought: reliefSought.trim(),
        noticeType,
      });
      setLegalNotice(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setNoticeBusy(false);
    }
  };

  const handleExportNoticeDocx = async () => {
    if (!legalNotice?.notice_text || exportingDocx) return;
    setExportingDocx(true);
    try {
      await contractsApi.downloadDocx(
        token,
        {
          title: legalNotice.notice_type || "FORMAL LEGAL NOTICE",
          fullText: legalNotice.notice_text,
          subtitle: legalNotice.subject || "",
          documentKind: "legal_notice",
          counselNotes: legalNotice.service_instructions || [],
          disclaimer: legalNotice.disclaimer || "",
        },
        `legal_notice_${contract.title || "contract"}`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingDocx(false);
    }
  };

  const copyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="drawer-stack">
      <section className="panel-section">
        <span className="section-eyebrow"><GavelIcon size={13} /> Counsel Litigation Strategy &amp; IPC / BNS 2023 Linkage</span>
        <p className="muted-caption">
          Evaluates how counsel can prevail in court or arbitration using exact contract provisions, Indian Civil/Commercial statutes,
          dual-mapped IPC (1860) ↔ BNS (2023) criminal remedies, evidentiary admissibility checks, and a formal Legal Notice generator.
        </p>

        <form onSubmit={handleAnalyzeStrategy} className="settings-form" style={{ marginTop: 12 }}>
          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="cs-party" className="field-label">Represented Party</label>
              <input
                id="cs-party"
                className="text-input input-sm"
                value={representedParty}
                onChange={(e) => setRepresentedParty(e.target.value)}
                placeholder="e.g., Kaveri Retail Ventures Pvt. Ltd."
                disabled={busy}
              />
            </div>
            <div className="field">
              <label className="field-label">Litigation Posture</label>
              <div className="segmented-control">
                <button type="button" className={`seg-btn ${posture === "claimant" ? "active" : ""}`} onClick={() => setPosture("claimant")}>
                  Claimant / Plaintiff
                </button>
                <button type="button" className={`seg-btn ${posture === "defendant" ? "active" : ""}`} onClick={() => setPosture("defendant")}>
                  Respondent / Defense
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="section-head-row">
              <label htmlFor="cs-facts" className="field-label">Dispute Fact Pattern <span className="field-optional">(or leave blank for pre-dispute readiness brief)</span></label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={startVoiceDictation} disabled={busy}>
                <MicIcon size={13} /> {listening ? "Listening..." : "Dictate"}
              </button>
            </div>
            <textarea
              id="cs-facts"
              className="text-input textarea-input"
              rows={3}
              value={disputeFacts}
              onChange={(e) => setDisputeFacts(e.target.value)}
              placeholder="Describe the breach, advance/deposit amount, missed milestones, cheque bounce, or data misuse..."
              disabled={busy}
            />
            <div className="prompt-chips" style={{ marginTop: 6 }}>
              {DISPUTE_PRESETS.slice(0, 3).map((p) => (
                <button key={p} type="button" className="chip-btn" onClick={() => setDisputeFacts(p)}>{p}</button>
              ))}
            </div>
          </div>

          <div className="form-footer-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <ScaleIcon size={14} /> {busy ? "Preparing Case Strategy..." : "Generate Winning Case Strategy"}
            </button>
          </div>
        </form>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {busy && <div className="state-box"><div className="spinner" /><p>Mapping contract clauses to Indian Civil, Arbitration, Evidence (BSA Sec. 63), and IPC/BNS 2023 remedies...</p></div>}

      {strategy && !busy && (
        <div className="drawer-stack">
          <section className="panel-section">
            <div className="section-head-row">
              <span className="section-eyebrow">Core Winning Theory</span>
              <div className="clause-head-right">
                <span className="mono-tag">{strategy.win_probability_band}</span>
                <span className={`risk-pill ${strategy.case_strength === "Strong" ? "risk-low" : strategy.case_strength === "Moderate" ? "risk-medium" : "risk-high"}`}>
                  {strategy.case_strength} CASE
                </span>
              </div>
            </div>
            <p className="summary-prose">{strategy.core_winning_theory}</p>
            <div className="remediation-note" style={{ marginTop: 8 }}>
              <strong>Forum &amp; Interim Relief Strategy:</strong> {strategy.forum_and_jurisdiction_note}
            </div>
          </section>

          <section className="panel-section">
            <span className="section-eyebrow">Criminal / Penal Statutory Tracks (IPC 1860 ↔ BNS 2023 &amp; Special Acts)</span>
            <div className="clause-list" style={{ marginTop: 8 }}>
              {(strategy.criminal_ipc_bns_tracks || []).map((tr, i) => (
                <article key={i} className="clause-item border-risk-high">
                  <div className="clause-item-head">
                    <div className="clause-title-wrap">
                      <span className="clause-category">{tr.offence_title}</span>
                      <span className="mono-caption">{tr.ipc_section}  ↔  {tr.bns_section}</span>
                    </div>
                    <span className="mono-tag">{tr.applicability}</span>
                  </div>
                  <p className="clause-explanation-text"><strong>Required Proof Ingredients:</strong> {tr.required_ingredients}</p>
                  <p className="muted-caption"><strong>Contract Trigger:</strong> {tr.contract_trigger}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <span className="section-eyebrow">Civil &amp; Commercial Remedies</span>
            <div className="clause-list" style={{ marginTop: 8 }}>
              {(strategy.civil_remedies || []).map((cv, i) => (
                <div key={i} className="brief-card">
                  <div className="section-head-row">
                    <strong>{cv.remedy_type}</strong>
                    <span className="law-ref-pill">{cv.statute}</span>
                  </div>
                  <p className="clause-explanation-text" style={{ marginTop: 4 }}>{cv.winning_application}</p>
                  <span className="mono-caption">Hook: {cv.contract_hook}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <span className="section-eyebrow">Winning Legal Arguments</span>
            <div className="clause-list" style={{ marginTop: 8 }}>
              {(strategy.winning_arguments || []).map((arg, i) => (
                <div key={i} className="brief-card">
                  <strong>{i + 1}. {arg.headline}</strong>
                  <p className="clause-explanation-text" style={{ marginTop: 4 }}>{arg.legal_basis}</p>
                  <span className="citation-tag" style={{ marginTop: 4, display: "inline-block" }}>{arg.contract_citation}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="brief-two-col">
            <section className="panel-section">
              <span className="section-eyebrow"><CheckCircleIcon size={13} /> Evidence &amp; Admissibility Checklist</span>
              <div className="session-list" style={{ marginTop: 8 }}>
                {(strategy.evidence_checklist || []).map((ev, i) => (
                  <div key={i} className="brief-card">
                    <div className="section-head-row">
                      <strong>{ev.document_or_proof}</strong>
                      <span className={`risk-pill risk-${ev.priority === "critical" ? "high" : ev.priority === "high" ? "medium" : "low"}`}>
                        {(ev.priority || "high").toUpperCase()}
                      </span>
                    </div>
                    <p className="muted-caption" style={{ marginTop: 4 }}>{ev.statutory_purpose}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel-section">
              <span className="section-eyebrow">Tactical Procedural Roadmap</span>
              <div className="session-list" style={{ marginTop: 8 }}>
                {(strategy.procedural_roadmap || []).map((st, i) => (
                  <div key={i} className="brief-card">
                    <strong>Step {st.step_number || i + 1}: {st.action}</strong>
                    <p className="muted-caption">{st.forum_or_mechanism} · {st.statutory_window}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {strategy.anticipated_defenses_and_rebuttals?.length > 0 && (
            <section className="panel-section">
              <span className="section-eyebrow"><AlertTriangleIcon size={13} /> Anticipated Opposing Defenses &amp; Rebuttals</span>
              <div className="clause-list" style={{ marginTop: 8 }}>
                {strategy.anticipated_defenses_and_rebuttals.map((d, i) => (
                  <div key={i} className="brief-card">
                    <p><strong>Opposing Defense:</strong> {d.anticipated_defense}</p>
                    <p style={{ marginTop: 4 }}><strong>Counsel Rebuttal:</strong> {d.counsel_rebuttal}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <section className="panel-section">
        <span className="section-eyebrow"><MailIcon size={13} /> Formal Indian Legal Notice Generator</span>
        <p className="muted-caption">
          Draft an advocate-ready Legal Demand Notice, Arbitration Invocation Notice (Sec. 21), or Sec. 138 NI Act Notice directly from this contract.
        </p>
        <div className="draft-two-col" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="ln-type" className="field-label">Notice Category</label>
            <select id="ln-type" className="select-input" value={noticeType} onChange={(e) => setNoticeType(e.target.value)} disabled={noticeBusy}>
              <option value="demand_and_cure">Legal Demand &amp; Breach Cure Notice</option>
              <option value="arbitration_invocation">Notice Invoking Arbitration (Sec. 21)</option>
              <option value="cheque_138">Statutory Notice u/s 138 NI Act</option>
              <option value="ip_data_cease_desist">Cease &amp; Desist — Confidentiality / IP Breach</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ln-relief" className="field-label">Specific Relief / Monetary Demand</label>
            <input
              id="ln-relief"
              className="text-input input-sm"
              value={reliefSought}
              onChange={(e) => setReliefSought(e.target.value)}
              placeholder="e.g., Refund INR 25,00,000 + 18% interest within 15 days"
              disabled={noticeBusy}
            />
          </div>
        </div>
        <div className="form-footer-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={handleDraftNotice} disabled={noticeBusy}>
            <MailIcon size={14} /> {noticeBusy ? "Drafting Formal Legal Notice..." : "Draft Formal Legal Notice"}
          </button>
        </div>

        {legalNotice && (
          <div className="drafted-missing-box" style={{ marginTop: 12 }}>
            <div className="section-head-row">
              <span className="section-eyebrow">{legalNotice.notice_type}</span>
              <div className="clause-head-right">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText("ln", legalNotice.notice_text)}>
                  {copiedId === "ln" ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleExportNoticeDocx} disabled={exportingDocx}>
                  <DownloadIcon size={13} /> {exportingDocx ? "Exporting..." : "Export .docx"}
                </button>
              </div>
            </div>
            <pre className="paper-manuscript" style={{ marginTop: 8, maxHeight: 380, overflow: "auto" }}>
              {legalNotice.notice_text}
            </pre>
            {legalNotice.service_instructions?.length > 0 && (
              <ul className="clean-list" style={{ marginTop: 8 }}>
                {legalNotice.service_instructions.map((s, idx) => <li key={idx}>{s}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
