import { useEffect } from "react";
import { AlertTriangleIcon, XIcon } from "./Icons";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  confirmTone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={() => !loading && onCancel()}>
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-title-row">
            <span className="dialog-icon-badge">
              <AlertTriangleIcon size={18} />
            </span>
            <h3 id="confirm-dialog-title">{title}</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close dialog"
          >
            <XIcon size={16} />
          </button>
        </div>

        <p className="dialog-message">{message}</p>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${confirmTone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Removing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
