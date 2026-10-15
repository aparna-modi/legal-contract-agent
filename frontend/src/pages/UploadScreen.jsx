import { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";

const UploadScreen = () => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { token, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="card auth-prompt-card">
        <div className="auth-prompt-content">
          <span className="prompt-icon">🔒</span>
          <h2>Authentication Required</h2>
          <p>Please log in to upload and store contracts for AI analysis.</p>
          <div className="auth-prompt-actions">
            <Link to="/login" className="btn btn-primary">
              Log In
            </Link>
            <Link to="/register" className="btn btn-secondary">
              Register
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const validateAndSetFile = (selectedFile) => {
    if (!selectedFile) return;

    const allowedExtensions = [".pdf", ".docx", ".txt"];
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      setFeedback({
        type: "error",
        text: `Invalid file type (${ext || "unknown"}). Only PDF, DOCX, and TXT are supported.`,
      });
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (selectedFile.size > maxSize) {
      setFeedback({
        type: "error",
        text: `File size (${(selectedFile.size / (1024 * 1024)).toFixed(1)}MB) exceeds the 10MB limit.`,
      });
      return;
    }

    setFile(selectedFile);
    setFeedback(null);
    if (!title.trim()) {
      setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const clearSelectedFile = (e) => {
    e.stopPropagation();
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file) {
      setFeedback({ type: "error", text: "Please select a contract document first." });
      return;
    }

    setUploading(true);
    setFeedback(null);

    const formData = new FormData();
    formData.append("contract", file);
    if (title.trim()) {
      formData.append("title", title.trim());
    }

    try {
      const response = await fetch("http://localhost:5001/api/contracts/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setFeedback({
          type: "success",
          text: `Contract "${data.document.title}" uploaded successfully! Redirecting...`,
        });
        setTimeout(() => {
          navigate("/");
        }, 1500);
      } else {
        setFeedback({
          type: "error",
          text: data.message || "Failed to upload contract. Please try again.",
        });
      }
    } catch (err) {
      console.error("Upload error:", err);
      setFeedback({
        type: "error",
        text: "Network error connecting to backend API. Ensure port 5000 is running.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <div className="upload-header">
        <h1 className="page-title">Upload Legal Contract</h1>
        <p className="page-subtitle">
          Securely submit your agreement to extract metadata, clauses, and risk factors
        </p>
      </div>

      <div className="card upload-card">
        {feedback && (
          <div className={`toast-alert toast-${feedback.type}`}>
            <span>{feedback.type === "success" ? "✅" : "⚠️"}</span>
            <span>{feedback.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="upload-form">
          <div className="form-group">
            <label htmlFor="contract-title" className="form-label">
              Contract Title <span className="label-optional">(Optional)</span>
            </label>
            <input
              id="contract-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Master Services Agreement 2026"
              className="form-input"
              disabled={uploading}
            />
          </div>

          <div
            className={`dropzone ${isDragging ? "dropzone-active" : ""} ${
              file ? "dropzone-has-file" : ""
            }`}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />

            {file ? (
              <div className="file-preview-card">
                <span className="file-preview-icon">
                  {file.name.toLowerCase().endsWith(".pdf")
                    ? "📕"
                    : file.name.toLowerCase().endsWith(".docx")
                    ? "📘"
                    : "📄"}
                </span>
                <div className="file-preview-info">
                  <p className="file-preview-name">{file.name}</p>
                  <p className="file-preview-size">
                    {(file.size / 1024).toFixed(1)} KB • Click to change file
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-remove-file"
                  onClick={clearSelectedFile}
                  title="Remove selected file"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="dropzone-prompt">
                <div className="dropzone-icon">☁️</div>
                <p className="dropzone-main-text">
                  Drag & drop your contract file here, or{" "}
                  <span className="browse-link">browse</span>
                </p>
                <p className="dropzone-hint">
                  Supports <strong>PDF</strong>, <strong>DOCX</strong>, and{" "}
                  <strong>TXT</strong> (Max 10MB)
                </p>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary btn-submit-upload"
              disabled={uploading || !file}
            >
              {uploading ? (
                <>
                  <span className="button-spinner"></span> Uploading...
                </>
              ) : (
                "Upload Contract for Processing"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadScreen;