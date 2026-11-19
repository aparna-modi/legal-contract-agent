import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { BrandMark, CheckCircleIcon } from "../components/Icons";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      const data = await authApi.register({ name, email, password });
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
        <BrandMark size={30} />
        <h2 className="auth-aside-title">Build a searchable library of your agreements.</h2>
        <p className="auth-aside-copy">
          Upload PDFs, Word agreements, or plain text contracts. Extract key facts, inspect risk
          drivers, and export structured Markdown review reports.
        </p>
        <ul className="auth-checklist">
          <li>
            <CheckCircleIcon size={15} />
            <span>Executive summaries & key-fact extraction</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Side-by-side contract comparison</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Cross-contract semantic search</span>
          </li>
        </ul>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-head">
          <h1>Create account</h1>
          <p>Start reviewing contracts in under a minute.</p>
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
              required
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="reg-email" className="field-label">
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              className="text-input"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="field">
            <label htmlFor="reg-password" className="field-label">
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              className="text-input"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
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
