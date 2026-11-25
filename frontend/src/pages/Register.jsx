import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { BrandMark, CheckCircleIcon, EyeIcon, EyeOffIcon } from "../components/Icons";

function evaluatePassword(pw) {
  const hasMinLen = pw.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasNumber = /\d/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  let score = 0;
  if (hasMinLen) score += 1;
  if (pw.length >= 12) score += 1;
  if (hasLetter && hasNumber) score += 1;
  if (hasSpecial) score += 1;
  const labels = ["", "Weak", "Fair", "Strong", "Very strong"];
  const tones = ["", "high", "medium", "low", "low"];
  return {
    hasMinLen,
    hasLetter,
    hasNumber,
    score,
    label: labels[score],
    tone: tones[score],
  };
}

export default function Register() {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const pwState = evaluatePassword(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!pwState.hasMinLen || !pwState.hasLetter || !pwState.hasNumber) {
      setError("Password must be at least 8 characters and include both a letter and a number.");
      return;
    }

    setLoading(true);
    try {
      const data = await authApi.register({
        name,
        email,
        password,
        organization: organization.trim() || undefined,
      });
      if (data.token) {
        login(data.user, data.token);
        navigate("/");
      } else {
        navigate("/login");
      }
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
        <h2 className="auth-aside-title">Build a searchable, private library of your agreements.</h2>
        <p className="auth-aside-copy">
          Upload PDFs, Word agreements, or plain text contracts. Extract structured key facts,
          triage risk drivers, and export counsel-ready reports.
        </p>
        <ul className="auth-checklist">
          <li>
            <CheckCircleIcon size={15} />
            <span>Executive summaries &amp; key-fact extraction</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Side-by-side redline contract comparison</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Cross-contract semantic search (Ctrl+K)</span>
          </li>
        </ul>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-head">
          <h1>Create account</h1>
          <p>Provision your isolated contract review workspace in seconds.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="reg-name" className="field-label">
              Full name
            </label>
            <input
              id="reg-name"
              type="text"
              className="text-input"
              placeholder="Aarav Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="reg-org" className="field-label">
              Workspace / Organization <span className="field-optional">(optional)</span>
            </label>
            <input
              id="reg-org"
              type="text"
              className="text-input"
              placeholder="e.g., Northstar Legal Ops"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="reg-email" className="field-label">
              Work email
            </label>
            <input
              id="reg-email"
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
            <label htmlFor="reg-password" className="field-label">
              Password
            </label>
            <div className="password-input-wrap">
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                className="text-input"
                placeholder="At least 8 characters with letters & numbers"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
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
            {password && (
              <div className="strength-row">
                <div className="strength-bars">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={`strength-seg ${
                        pwState.score >= step ? `seg-${pwState.tone}` : ""
                      }`}
                    />
                  ))}
                </div>
                <span className="mono-caption">{pwState.label}</span>
              </div>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Provisioning workspace..." : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{" "}
          <Link to="/login" className="inline-link">
            Sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
