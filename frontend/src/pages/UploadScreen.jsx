import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CheckCircleIcon, FileTextIcon, LockIcon, UploadIcon, XIcon } from "../components/Icons";
import { PageReveal } from "../components/Motion";
import { EASE_EDITORIAL } from "../components/motionTokens";

const ALLOWED_EXT = [".pdf", ".docx", ".txt"];
const MAX_BYTES = 10 * 1024 * 1024;
const STEPS = [
  "Validating document format",
  "Uploading contract securely",
  "Extracting clauses, loopholes & statutory exposure",
  "Indexing sections for citation-backed search",
];

const ROLE_OPTIONS = [
  { value: "", label: "Auto-detect / General Review" },
  { value: "client_buyer", label: "Client / Buyer / Customer" },
  { value: "vendor_seller", label: "Vendor / Service Provider / Seller" },
  { value: "employee", label: "Employee / Executive" },
  { value: "employer", label: "Employer / Company" },
  { value: "tenant", label: "Tenant / Lessee" },
  { value: "landlord", label: "Landlord / Lessor" },
  { value: "contractor", label: "Independent Contractor / Consultant" },
  { value: "founder_investor", label: "Founder / Shareholder / Licensor" },
];

export default function UploadScreen() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const pollTimerRef = useRef(null);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [userPartyName, setUserPartyName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [shareTeam, setShareTeam] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(0);
  const [percent, setPercent] = useState(0);
  const [stageMessage, setStageMessage] = useState("");
  const [uploadedId, setUploadedId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
  }, []);

  const selectFile = (selected) => {
    if (!selected) return;
    const ext = selected.name.includes(".") ? selected.name.slice(selected.name.lastIndexOf(".")).toLowerCase() : "";
    if (!ALLOWED_EXT.includes(ext)) {
      return setFeedback({ tone: "error", text: `Unsupported format (${ext || "unknown"}). Upload PDF, DOCX, or TXT.` });
    }
    if (selected.size > MAX_BYTES) {
      return setFeedback({ tone: "error", text: `File is ${(selected.size / 1048576).toFixed(1)} MB — max size is 10 MB.` });
    }
    setFile(selected);
    setFeedback(null);
    setUploadedId(null);
    if (!title.trim()) setTitle(selected.name.replace(/\.[^/.]+$/, ""));
  };

  const pollExtractionJob = (jobId) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await contractsApi.jobStatus(token, jobId);
        const job = res?.job || res;
        const pct = Number(job?.percent || 0);
        if (pct > 0) setPercent(Math.max(35, Math.min(98, pct)));
        if (job?.message) setStageMessage(job.message);
        if (pct >= 80) setStep(4);

        if (job?.status === "completed") {
          setStep(4);
          setPercent(100);
          setStageMessage("Analysis complete.");
          return resolve(job);
        }
        if (job?.status === "failed") {
          return reject(new Error(job?.error || "Contract extraction failed."));
        }
        if (Date.now() - started > 180000) {
          return reject(new Error("Extraction is taking longer than expected. Open Workspace to track completion."));
        }
        pollTimerRef.current = window.setTimeout(tick, 900);
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return setFeedback({ tone: "error", text: "Select a contract file first." });

    setFeedback(null);
    setUploadedId(null);
    setStageMessage("Checking document format...");
    setStep(1);
    setPercent(12);

    const form = new FormData();
    form.append("contract", file);
    if (title.trim()) form.append("title", title.trim());
    if (userPartyName.trim()) form.append("userPartyName", userPartyName.trim());
    if (userRole) form.append("userRole", userRole);
    if (shareTeam && user?.organizationId) form.append("visibility", "team");

    try {
      setStep(2);
      setStageMessage("Uploading document to your private workspace...");
      const { document: doc } = await contractsApi.upload(token, form);
      setUploadedId(doc?._id || null);
      setPercent(32);

      if (autoAnalyze && doc?._id) {
        setStep(3);
        setStageMessage("Queueing clause extraction, loophole audit, and statutory mapping...");
        let asyncHandled = false;
        try {
          const queued = await contractsApi.extractAsync(token, doc._id);
          const jobId = queued?.jobId || queued?.job?.id;
          if (jobId) {
            asyncHandled = true;
            await pollExtractionJob(jobId);
          }
        } catch {
          // Fall back to synchronous extraction if async worker queue is unavailable
        }
        if (!asyncHandled) {
          setStageMessage("Running full clause extraction and risk audit...");
          await contractsApi.extract(token, doc._id);
          setStep(4);
          setPercent(100);
        }
      } else {
        setStep(4);
        setPercent(100);
      }

      setFeedback({ tone: "success", text: `"${doc.title}" ${autoAnalyze ? "uploaded and analyzed" : "uploaded"}. Opening workspace...` });
      setTimeout(() => navigate("/"), 700);
    } catch (err) {
      setFeedback({ tone: "error", text: err.message });
      setStep(0);
      setPercent(0);
      setStageMessage("");
    }
  };

  const busy = step > 0 && step < 4 && !feedback?.tone;

  return (
    <PageReveal className="narrow-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Upload Contract</h1>
          <p className="page-description">Submit a PDF (including scanned agreements via OCR), DOCX, or TXT file for clause extraction, loophole auditing, and statutory risk review.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="surface-card upload-form">
        {feedback && (
          <div className={`alert alert-${feedback.tone}`}>
            <span>{feedback.text}</span>
            {feedback.tone === "error" && uploadedId && (
              <div style={{ marginTop: 6 }}>
                <Link to="/" className="inline-link">Your file was saved — open Workspace to retry analysis →</Link>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="contract-title" className="field-label">Contract Title <span className="field-optional">(optional)</span></label>
          <input id="contract-title" className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Master Services Agreement — Northstar LLC" disabled={busy} />
        </div>

        <div className="upload-perspective-grid">
          <div className="field">
            <label htmlFor="user-role" className="field-label">Side You Represent <span className="field-optional">(tailors protection score)</span></label>
            <select id="user-role" className="select-input" value={userRole} onChange={(e) => setUserRole(e.target.value)} disabled={busy}>
              {ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="user-party" className="field-label">Your Entity / Party Name <span className="field-optional">(optional)</span></label>
            <input id="user-party" className="text-input" value={userPartyName} onChange={(e) => setUserPartyName(e.target.value)} placeholder="e.g., Kaveri FinTech Pvt. Ltd." disabled={busy} />
          </div>
        </div>

        <div
          className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label="Upload contract file (PDF, DOCX, or TXT)"
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (!busy && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); selectFile(e.dataTransfer.files?.[0]); }}
        >
          <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" className="sr-only" onChange={(e) => selectFile(e.target.files?.[0])} />
          {file ? (
            <div className="selected-file-row">
              <span className="selected-file-icon"><FileTextIcon size={20} /></span>
              <div className="selected-file-meta">
                <span className="selected-file-name">{file.name}</span>
                <span className="mono-caption">{(file.size / 1024).toFixed(1)} KB · Click to replace</span>
              </div>
              <button type="button" className="icon-btn" disabled={busy} aria-label="Remove file" onClick={(e) => { e.stopPropagation(); setFile(null); if (inputRef.current) inputRef.current.value = ""; }}>
                <XIcon size={16} />
              </button>
            </div>
          ) : (
            <div className="dropzone-empty">
              <span className="dropzone-icon-wrap"><UploadIcon size={22} /></span>
              <p className="dropzone-title">Drop a contract here, or <span className="inline-link">browse files</span></p>
              <p className="muted-caption">PDF, DOCX, or TXT up to 10 MB</p>
            </div>
          )}
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} disabled={busy} />
          <span>Run full clause audit, loophole detection, and 5-axis scorecard right after upload</span>
        </label>
        {user?.organizationId && (
          <label className="checkbox-row">
            <input type="checkbox" checked={shareTeam} onChange={(e) => setShareTeam(e.target.checked)} disabled={busy} />
            <span>Share this contract with members of {user.organization}</span>
          </label>
        )}

        {step > 0 && (
          <div className="pipeline-stepper" aria-live="polite">
            {percent > 0 && (
              <div className="risk-bar" style={{ marginBottom: 6 }}>
                <motion.div
                  className="risk-bar-seg seg-low"
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.35, ease: EASE_EDITORIAL }}
                />
              </div>
            )}
            {stageMessage && (
              <div className="live-stage-caption">
                <span>{stageMessage}</span>
                <span className="mono-caption">{percent}%</span>
              </div>
            )}
            {STEPS.slice(0, autoAnalyze ? 4 : 2).map((label, idx) => {
              const id = idx + 1;
              const done = step > id || (step === 4 && id === 4);
              const current = step === id && !done;
              return (
                <div key={id} className={`pipeline-step ${done ? "done" : current ? "current" : ""}`}>
                  <span className="step-indicator">
                    {done ? <CheckCircleIcon size={15} /> : current ? <span className="mini-spinner" /> : id}
                  </span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="upload-security-note">
          <LockIcon size={14} />
          <span>Your uploaded agreements remain private to your account unless explicitly shared with your team.</span>
        </div>

        <div className="form-footer-row">
          <Link to="/" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? "Processing..." : autoAnalyze ? "Upload & Analyze" : "Upload Contract"}
          </button>
        </div>
      </form>
    </PageReveal>
  );
}
