import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { FileTextIcon, UploadIcon, XIcon } from "../components/Icons";

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export default function UploadScreen() {
  const { token, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState("");
  const [feedback, setFeedback] = useState(null);

  if (!isAuthenticated) {
    return (
      <div className="surface-card empty-box centered-card">
        <h3>Sign in to upload contracts</h3>
        <p>Create an account or sign in to store and analyze agreements privately.</p>
        <div className="hero-actions">
          <Link to="/login" className="btn btn-primary">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-secondary">
            Create account
          </Link>
        </div>
      </div>
    );
  }

  const validateAndSelect = (selected) => {
    if (!selected) return;
    const dotIdx = selected.name.lastIndexOf(".");
    const ext = dotIdx >= 0 ? selected.name.slice(dotIdx).toLowerCase() : "";

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFeedback({
        tone: "error",
        text: `Unsupported format (${ext || "unknown"}). Upload a PDF, DOCX, or TXT file.`,
      });
      return;
    }

    if (selected.size > MAX_SIZE_BYTES) {
      setFeedback({
        tone: "error",
        text: `File is ${(selected.size / (1024 * 1024)).toFixed(1)} MB — maximum allowed size is 10 MB.`,
      });
      return;
    }

    setFile(selected);
    setFeedback(null);
    if (!title.trim()) {
      setTitle(selected.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const clearFile = (e) => {
    e.stopPropagation();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setFeedback({ tone: "error", text: "Select a contract file first." });
      return;
    }

    setFeedback(null);
    setStage("Uploading contract...");

    const formData = new FormData();
    formData.append("contract", file);
    if (title.trim()) {
      formData.append("title", title.trim());
    }

    try {
      const uploaded = await contractsApi.upload(token, formData);
      const doc = uploaded.document;

      if (autoAnalyze && doc?._id) {
        setStage("Extracting clauses, scoring risks, and indexing vectors...");
        await contractsApi.extract(token, doc._id);
      }

      setFeedback({
        tone: "success",
        text: autoAnalyze
          ? `"${doc.title}" uploaded and analyzed. Opening workspace...`
          : `"${doc.title}" uploaded. Opening workspace...`,
      });
      setTimeout(() => navigate("/"), 700);
    } catch (err) {
      setFeedback({ tone: "error", text: err.message });
    } finally {
      setStage("");
    }
  };

  const busy = Boolean(stage);

  return (
    <div className="narrow-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Upload Contract</h1>
          <p className="page-description">
            Submit a PDF, Word document, or plain-text agreement for structured clause extraction
            and risk review.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="surface-card upload-form">
        {feedback && <div className={`alert alert-${feedback.tone}`}>{feedback.text}</div>}

        <div className="field">
          <label htmlFor="contract-title" className="field-label">
            Contract Title <span className="field-optional">(optional)</span>
          </label>
          <input
            id="contract-title"
            type="text"
            className="text-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Master Services Agreement — Northstar LLC"
            disabled={busy}
          />
        </div>

        <div
          className={`dropzone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onClick={() => !busy && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.[0]) validateAndSelect(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && validateAndSelect(e.target.files[0])}
          />

          {file ? (
            <div className="selected-file-row">
              <span className="selected-file-icon">
                <FileTextIcon size={20} />
              </span>
              <div className="selected-file-meta">
                <span className="selected-file-name">{file.name}</span>
                <span className="mono-caption">
                  {(file.size / 1024).toFixed(1)} KB · Click to replace
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={clearFile}
                disabled={busy}
                aria-label="Remove file"
              >
                <XIcon size={16} />
              </button>
            </div>
          ) : (
            <div className="dropzone-empty">
              <span className="dropzone-icon-wrap">
                <UploadIcon size={22} />
              </span>
              <p className="dropzone-title">
                Drop a contract here, or <span className="inline-link">browse files</span>
              </p>
              <p className="muted-caption">PDF, DOCX, or TXT up to 10 MB</p>
            </div>
          )}
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoAnalyze}
            onChange={(e) => setAutoAnalyze(e.target.checked)}
            disabled={busy}
          />
          <span>
            Run AI clause extraction, risk scoring, summary, and vector indexing immediately
          </span>
        </label>

        <div className="form-footer-row">
          <Link to="/" className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? stage : autoAnalyze ? "Upload & Analyze" : "Upload Contract"}
          </button>
        </div>
      </form>
    </div>
  );
}
