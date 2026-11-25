import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangleIcon, XIcon } from "./Icons";
import { EASE_EDITORIAL } from "./motionTokens";

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => !loading && onCancel()}
        >
          <motion.div
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.2, ease: EASE_EDITORIAL }}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
