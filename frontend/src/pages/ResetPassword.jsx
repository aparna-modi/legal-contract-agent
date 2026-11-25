import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";
import { BrandMark, CheckCircleIcon } from "../components/Icons";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(() => searchParams.get("token") || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [doneMessage, setDoneMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPassword({ token, newPassword });
      setDoneMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="narrow-page">
      <section className="surface-card upload-form" style={{ maxWidth: 480, margin: "28px auto" }}>
        <div className="auth-panel-head">
          <BrandMark size={28} />
          <h1 style={{ marginTop: 10 }}>Choose a new password</h1>
          <p>Updating your password immediately revokes all previously active sessions.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {doneMessage ? (
          <div className="alert alert-success">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircleIcon size={16} />
              <span>{doneMessage}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Link to="/login" className="btn btn-primary btn-sm">
                Sign in now
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="field">
              <label htmlFor="rp-token" className="field-label">
                Reset token
              </label>
              <input
                id="rp-token"
                type="text"
                className="text-input"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="field">
              <label htmlFor="rp-pw" className="field-label">
                New password
              </label>
              <input
                id="rp-pw"
                type="password"
                className="text-input"
                placeholder="At least 8 characters with letters & numbers"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="field">
              <label htmlFor="rp-confirm" className="field-label">
                Confirm password
              </label>
              <input
                id="rp-confirm"
                type="password"
                className="text-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
