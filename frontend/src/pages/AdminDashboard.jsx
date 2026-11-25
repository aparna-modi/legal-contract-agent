import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { systemApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CheckCircleIcon, ClockIcon, LockIcon, RefreshIcon, ServerIcon, ShieldCheckIcon } from "../components/Icons";
import { PageReveal } from "../components/Motion";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await systemApi.adminOverview(token));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || user?.role !== "admin") return;
    let active = true;
    systemApi.adminOverview(token)
      .then((res) => active && (setData(res), setError(null)))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token, user?.role]);

  if (user?.role !== "admin") {
    return (
      <div className="surface-card empty-box centered-card">
        <LockIcon size={28} />
        <h3>Administrator access required</h3>
        <p>Platform-wide usage, feedback monitoring, and cross-account audit logs are restricted to Admin roles.</p>
        <Link to="/security" className="btn btn-primary">Manage Workspace Role</Link>
      </div>
    );
  }

  const users = data?.users || { total: 0, roles: {}, accounts: [] };
  const contracts = data?.contracts || {};
  const quality = data?.quality || {};
  const infra = data?.infrastructure || {};
  const logs = data?.auditLogs || [];

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Platform Admin Console</h1>
          <p className="page-description">Cross-account usage, AI quality metrics, cluster telemetry, and security audit monitoring.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshIcon size={15} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="surface-card state-box"><div className="spinner" /><p>Loading platform metrics...</p></div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Registered Accounts</span>
              <span className="kpi-value">{users.total}</span>
              <span className="kpi-sub">{users.roles?.admin || 0} admin · {users.roles?.counsel || 0} counsel · {users.roles?.reviewer || 0} reviewer</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Platform Contracts</span>
              <span className="kpi-value">{contracts.total || 0}</span>
              <span className="kpi-sub">{contracts.analyzed || 0} analyzed · {contracts.totalClauses || 0} clauses</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Grounded Q&amp;A Rate</span>
              <span className="kpi-value text-accent">
                {quality.totalQuestions ? `${Math.round((quality.groundedCount / quality.totalQuestions) * 100)}%` : "—"}
              </span>
              <span className="kpi-sub">{quality.totalQuestions || 0} queries · avg {((quality.avgLatencyMs || 0) / 1000).toFixed(2)}s</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Global Helpfulness</span>
              <span className="kpi-value">{quality.helpfulnessRate != null ? `${quality.helpfulnessRate}%` : "—"}</span>
              <span className="kpi-sub">{quality.feedbackUp || 0} up · {quality.feedbackDown || 0} down</span>
            </div>
          </div>

          <section className="surface-card settings-card">
            <div className="section-head-row">
              <span className="section-eyebrow"><ServerIcon size={14} /> Cluster &amp; Service Health</span>
              <span className="mono-tag">{infra.aiPool?.healthyNodes || 0}/{infra.aiPool?.totalNodes || 0} AI Nodes Healthy</span>
            </div>
            <div className="infra-grid">
              <div className="infra-stat">
                <span className="kpi-label">Database</span>
                <strong className="infra-value"><CheckCircleIcon size={14} className="text-accent" /> {infra.database || "connected"}</strong>
                <span className="mono-caption">MongoDB</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Object Storage</span>
                <strong className="infra-value">{(infra.storage || "local").toUpperCase()}</strong>
                <span className="mono-caption">Pluggable S3/Local</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Redis Store</span>
                <strong className="infra-value">{infra.redis?.connected ? "Connected" : infra.redis?.mode || "Memory"}</strong>
                <span className="mono-caption">Rate-limit &amp; Cache</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Extraction Queue</span>
                <strong className="infra-value">{infra.queue?.active || 0} active · {infra.queue?.queued || 0} queued</strong>
                <span className="mono-caption">{infra.queue?.completed || 0} completed</span>
              </div>
            </div>
          </section>

          <div className="analytics-grid">
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow"><ShieldCheckIcon size={14} /> Accounts ({users.accounts.length})</span>
                <span className="mono-caption">Latest signups</span>
              </div>
              <div className="session-list">
                {users.accounts.map((acc) => (
                  <div key={acc._id} className="session-row">
                    <div className="session-info">
                      <strong>{acc.name}</strong>
                      <span className="mono-caption">{acc.email} · {acc.organization || "Personal"}</span>
                    </div>
                    <div className="row-actions">
                      <span className="mono-tag">{(acc.role || "reviewer").toUpperCase()}</span>
                      <span className="mono-caption">{fmtDate(acc.lastLoginAt || acc.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow"><ClockIcon size={13} /> Cross-Account Audit Trail</span>
                <span className="mono-caption">Latest {logs.length}</span>
              </div>
              {logs.length === 0 ? (
                <p className="muted-caption">No audit events recorded yet.</p>
              ) : (
                <div className="audit-list">
                  {logs.map((entry) => (
                    <div key={entry._id} className="audit-row">
                      <span className="mono-tag">{entry.action}</span>
                      <span className="audit-summary">
                        {entry.user?.email ? `${entry.user.email}: ` : ""}{entry.summary}
                      </span>
                      <span className="mono-caption">{fmtDate(entry.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </PageReveal>
  );
}
