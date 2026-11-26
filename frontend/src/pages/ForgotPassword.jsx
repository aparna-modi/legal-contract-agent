import { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/client";
import { BrandMark, LockIcon } from "../components/Icons";
import { PageReveal } from "../components/Motion";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.forgotPassword(email);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageReveal className="narrow-page">
      <section className="surface-card upload-form" style={{ maxWidth: 480, margin: "28px auto" }}>
        <div className="auth-panel-head">
          <BrandMark size={28} />
          <h1 style={{ marginTop: 10 }}>Reset password</h1>
          <p>Enter your email address and we&apos;ll send a password reset link valid for 30 minutes.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {result && (
          <div className="alert alert-success">
            <p>{result.message}</p>
            {result.devResetToken && (
              <p style={{ marginTop: 8 }}>
                <strong>Local dev preview:</strong>{" "}
                <Link
                  to={`/reset-password?token=${encodeURIComponent(result.devResetToken)}`}
                  className="inline-link"
                >
                  Open password reset link
                </Link>
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="fp-email" className="field-label">
              Email
            </label>
            <input
              id="fp-email"
              type="email"
              className="text-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            <LockIcon size={15} />
            {loading ? "Issuing reset link..." : "Send reset instructions"}
          </button>
        </form>

        <p className="auth-switch">
          Remembered your password?{" "}
          <Link to="/login" className="inline-link">
            Return to sign in
          </Link>
        </p>
      </section>
    </PageReveal>
  );
}
