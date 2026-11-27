import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { contractsApi } from "../api/client";
import { CheckCircleIcon, CheckIcon, CopyIcon, DownloadIcon, PenToolIcon, ShieldCheckIcon } from "./Icons";

const ROLE_OPTIONS = [
  { id: "client_buyer", label: "Client / Buyer / Customer" },
  { id: "vendor_seller", label: "Vendor / Service Provider / Seller" },
  { id: "employee", label: "Employee / Executive" },
  { id: "employer", label: "Employer / Company" },
  { id: "tenant", label: "Tenant / Lessee" },
  { id: "landlord", label: "Landlord / Lessor" },
  { id: "contractor", label: "Independent Contractor / Consultant" },
  { id: "founder_investor", label: "Founder / Shareholder / Licensor" },
];

export default function ProtectMySidePanel({ contract, token, onSavedNewVersion }) {
  const navigate = useNavigate();
  const parties = contract.keyFacts?.parties || [];
  const [userParty, setUserParty] = useState(contract.userPartyName || parties[0] || "");
  const [userRole, setUserRole] = useState(
    contract.userRole && contract.userRole !== "neutral" ? contract.userRole : "client_buyer"
  );
  const [aggressiveness, setAggressiveness] = useState("maximum_user_only");
  const [customPriorities, setCustomPriorities] = useState("");

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [copied, setCopied] = useState(false);
  const [viewTab, setViewTab] = useState("changes");

  const handleRewrite = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const res = await contractsApi.rewriteUserOnly(token, contract._id, {
        userParty: userParty.trim(),
        userRole,
        aggressiveness,
        jurisdiction: contract.keyFacts?.governingLaw || "India (Indian Contract Act, 1872)",
        customPriorities: customPriorities.trim(),
      });
      setResult(res);
      setViewTab("changes");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProtectedCopy = async () => {
    if (!result?.rewritten_full_text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await contractsApi.saveDraft(token, {
        title: result.title || `${contract.title} — Protected Redraft`,
        fullText: result.rewritten_full_text,
        autoAnalyze: true,
        parentDocument: contract._id,
        userPartyName: userParty.trim(),
        userRole,
      });
      setBanner("Protected counter-proposal saved and analyzed in your workspace. You can now run a side-by-side comparison against the original.");
      onSavedNewVersion?.(saved.document);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportDocx = async () => {
    if (!result?.rewritten_full_text || exportingDocx) return;
    setExportingDocx(true);
    setError(null);
    try {
      await contractsApi.downloadDocx(
        token,
        {
          title: result.title || `${contract.title} — Protected Redraft`,
          fullText: result.rewritten_full_text,
          subtitle: `Representing: ${result.represented_party}`,
          jurisdiction: result.jurisdiction || "",
          counselNotes: result.enforceability_notes || [],
          disclaimer: result.disclaimer || "",
        },
        `${contract.title || "contract"}_protected`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingDocx(false);
    }
  };

  const copyFull = async () => {
    if (!result?.rewritten_full_text) return;
    try {
      await navigator.clipboard.writeText(result.rewritten_full_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const metrics = result?.before_after_metrics;

  return (
    <div className="drawer-stack">
      <section className="panel-section">
        <span className="section-eyebrow"><ShieldCheckIcon size={13} /> Exclusive User-Side Protective Rewriter</span>
        <p className="muted-caption">
          Redrafts the entire agreement strictly in your favor—eliminating adverse exposure, flipping one-sided counterparty clauses,
          and inserting role-specific safeguards while keeping every provision enforceable under governing law.
        </p>

        <form onSubmit={handleRewrite} className="settings-form" style={{ marginTop: 12 }}>
          {parties.length > 0 && (
            <div className="prompt-chips">
              <span className="chip-prefix">Select your party</span>
              {parties.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip-btn ${userParty === p ? "chip-active" : ""}`}
                  onClick={() => setUserParty(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="draft-two-col">
            <div className="field">
              <label htmlFor="prot-party" className="field-label">Party You Represent</label>
              <input
                id="prot-party"
                className="text-input input-sm"
                value={userParty}
                onChange={(e) => setUserParty(e.target.value)}
                placeholder="e.g., Kaveri Retail Ventures Pvt. Ltd."
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="prot-role" className="field-label">Commercial Role</label>
              <select
                id="prot-role"
                className="select-input"
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                disabled={busy}
              >
                {ROLE_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            </div>
          </div>

          <div className="segmented-control">
            <button
              type="button"
              className={`seg-btn ${aggressiveness === "maximum_user_only" ? "active" : ""}`}
              onClick={() => setAggressiveness("maximum_user_only")}
              disabled={busy}
            >
              Protect Only My Side (Maximum)
            </button>
            <button
              type="button"
              className={`seg-btn ${aggressiveness === "firm_negotiable" ? "active" : ""}`}
              onClick={() => setAggressiveness("firm_negotiable")}
              disabled={busy}
            >
              Firm Negotiable Counter-Proposal
            </button>
          </div>

          <div className="field">
            <label htmlFor="prot-notes" className="field-label">
              Specific Deal Priorities <span className="field-optional">(optional)</span>
            </label>
            <input
              id="prot-notes"
              className="text-input input-sm"
              value={customPriorities}
              onChange={(e) => setCustomPriorities(e.target.value)}
              placeholder="e.g., Insist on 30-day acceptance testing, full advance refund on delay, and Bengaluru jurisdiction"
              disabled={busy}
            />
          </div>

          <div className="form-footer-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <PenToolIcon size={14} /> {busy ? "Redrafting agreement in your favor..." : "Rewrite Present Contract for My Side"}
            </button>
          </div>
        </form>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {banner && (
        <div className="alert alert-success">
          <span>{banner}</span>{" "}
          <button type="button" className="inline-link" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => navigate("/compare")}>
            Open Compare →
          </button>
        </div>
      )}

      {busy && (
        <div className="state-box">
          <div className="spinner" />
          <p>Rewriting adverse clauses, sealing loopholes, injecting missing protections, and verifying statutory enforceability...</p>
        </div>
      )}

      {result && !busy && (
        <div className="drawer-stack">
          {metrics && (
            <div className="scorecard-grid">
              <div className="scorecard-cell">
                <span className="scorecard-label">User Protection</span>
                <strong className="text-accent">{metrics.user_protection_before} → {metrics.user_protection_after}/100</strong>
                <span className="muted-caption">Net protection gain</span>
              </div>
              <div className="scorecard-cell">
                <span className="scorecard-label">Risk Exposure</span>
                <strong className="text-accent">{metrics.risk_before} → {metrics.risk_after}/100</strong>
                <span className="muted-caption">Exposure reduced</span>
              </div>
              <div className="scorecard-cell">
                <span className="scorecard-label">Overall Health</span>
                <strong>{metrics.health_before} → {metrics.health_after}/100</strong>
                <span className="muted-caption">Execution readiness</span>
              </div>
              <div className="scorecard-cell">
                <span className="scorecard-label">Loopholes Closed</span>
                <strong>{metrics.loopholes_closed} sealed</strong>
                <span className="muted-caption">+{result.inserted_protections?.length || 0} safeguards added</span>
              </div>
            </div>
          )}

          <section className="panel-section">
            <div className="section-head-row">
              <div className="segmented-control">
                <button type="button" className={`seg-btn ${viewTab === "changes" ? "active" : ""}`} onClick={() => setViewTab("changes")}>
                  Clause Transformations ({result.clause_transformations?.length || 0})
                </button>
                <button type="button" className={`seg-btn ${viewTab === "manuscript" ? "active" : ""}`} onClick={() => setViewTab("manuscript")}>
                  Full Rewritten Contract
                </button>
              </div>
              <div className="clause-head-right">
                <button type="button" className="btn btn-secondary btn-sm" onClick={copyFull}>
                  {copied ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportDocx} disabled={exportingDocx}>
                  <DownloadIcon size={13} /> {exportingDocx ? "Exporting..." : ".docx"}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveProtectedCopy} disabled={saving}>
                  <CheckCircleIcon size={13} /> {saving ? "Saving..." : "Save to Workspace"}
                </button>
              </div>
            </div>

            <p className="summary-prose" style={{ marginTop: 10 }}>{result.executive_summary}</p>

            {viewTab === "changes" ? (
              <div className="clause-list" style={{ marginTop: 10 }}>
                {(result.clause_transformations || []).map((tr, i) => (
                  <article key={i} className="clause-item border-risk-low">
                    <div className="clause-item-head">
                      <span className="clause-category">{tr.clause_type}</span>
                      {tr.statutory_anchor && <span className="law-ref-pill">{tr.statutory_anchor}</span>}
                    </div>
                    <p className="clause-rationale"><strong>Previous Exposure:</strong> {tr.what_was_hurting_you}</p>
                    <p className="clause-explanation-text"><strong>New Protection:</strong> {tr.how_this_protects_you}</p>
                    <div className="remediation-note" style={{ marginTop: 8 }}>
                      <strong>Rewritten Wording:</strong>
                      <p style={{ marginTop: 4 }}>{tr.rewritten_clause}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <pre className="paper-manuscript" style={{ marginTop: 12, maxHeight: 460, overflow: "auto" }}>
                {result.rewritten_full_text}
              </pre>
            )}

            {result.enforceability_notes?.length > 0 && (
              <div className="brief-card" style={{ marginTop: 12 }}>
                <span className="brief-card-label">Enforceability Verification (Senior Counsel Check)</span>
                <ul className="clean-list">
                  {result.enforceability_notes.map((n, idx) => <li key={idx}>{n}</li>)}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
