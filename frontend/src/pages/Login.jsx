import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { BrandMark, CheckCircleIcon } from "../components/Icons";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await authApi.login({ email, password });
      login(data.user, data.token);
      navigate("/");
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
        <h2 className="auth-aside-title">Grounded contract review without guesswork.</h2>
        <p className="auth-aside-copy">
          Review clauses, flag risks, compare contract revisions, and query your agreements with
          verifiable page and section citations.
        </p>
        <ul className="auth-checklist">
          <li>
            <CheckCircleIcon size={15} />
            <span>Private multi-tenant document & vector isolation</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>14-category legal taxonomy & missing-clause alerts</span>
          </li>
          <li>
            <CheckCircleIcon size={15} />
            <span>Strict refusal when a contract does not state an answer</span>
          </li>
        </ul>
      </aside>

      <section className="auth-panel">
        <div className="auth-panel-head">
          <h1>Sign in</h1>
          <p>Access your saved contracts and analysis reports.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="login-email" className="field-label">
              Email address
            </label>
            <input
              id="login-email"
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
            <label htmlFor="login-password" className="field-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="text-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          New here?{" "}
          <Link to="/register" className="inline-link">
            Create an account
          </Link>
        </p>
      </section>
    </div>
  );
}
