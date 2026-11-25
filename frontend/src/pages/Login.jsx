import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { BrandMark, CheckCircleIcon, EyeIcon, EyeOffIcon } from "../components/Icons";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await authApi.login({ email, password });
      login(data.user, data.token);
      const next = searchParams.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-split">
      <aside className="auth-aside">
        <BrandMark size={32} />
        <h2 className="auth-aside-title">Grounded contract review without guesswork.</h2>
        <p className="auth-aside-copy">
          Review clauses, flag commercial risks, redline contract revisions, and query agreements
          with verifiable page and section citations.
        </p>
        <ul className="auth-checklist">
          <li>
            <CheckCircleIcon size={15} />
            <span>Private multi-tenant document &amp; vector isolation</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Short-lived JWTs with rotating HttpOnly refresh sessions</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Strict refusal when an agreement does not state an answer</span>
          </li>
        </ul>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-head">
          <h1>Sign in</h1>
          <p>Access your saved contracts, risk analytics, and audit trail.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="login-email" className="field-label">
              Work email
            </label>
            <input
              id="login-email"
              type="email"
              className="text-input"
              placeholder="counsel@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={loading}
            />
          </div>

          <div className="field">
            <div className="section-head-row">
              <label htmlFor="login-password" className="field-label">
                Password
              </label>
              <Link to="/forgot-password" className="inline-link" style={{ fontSize: 12.5 }}>
                Forgot password?
              </Link>
            </div>
            <div className="password-input-wrap">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                className="text-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Authenticating..." : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          New to Legal Contract Agent?{" "}
          <Link to="/register" className="inline-link">
            Create workspace account
          </Link>
        </p>
      </section>
    </div>
  );
}
