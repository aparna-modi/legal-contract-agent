import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { systemApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CheckCircleIcon, ClockIcon, LockIcon, RefreshIcon, ServerIcon, ShieldCheckIcon } from "../components/Icons";
import { PageReveal } from "../components/Motion";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const ACTION_LABELS = {
  register: "Sign Up",
  login: "Sign In",
  login_failed: "Failed Login",
  logout: "Sign Out",
  logout_all: "Sign Out All",
  token_refresh: "Session Refresh",
  token_reuse_detected: "Security Alert",
  password_changed: "Password Updated",
  password_reset_requested: "Reset Requested",
  password_reset_completed: "Password Reset",
  profile_updated: "Profile Updated",
  session_revoked: "Session Revoked",
  team_invited: "Team Invite",
  team_joined: "Joined Team",
  team_role_updated: "Role Updated",
  team_member_removed: "Member Removed",
  upload: "Uploaded",
  extract: "Analyzed",
  ask: "Contract Q&A",
  search: "Library Search",
  compare: "Compared",
  draft_generated: "Draft Created",
  draft_revised: "Draft Revised",
  redline_suggested: "Redline Suggested",
  missing_clause_drafted: "Clause Drafted",
  playbook_evaluated: "Playbook Check",
  playbook_updated: "Playbook Saved",
  playbook_rules_generated: "Rules Generated",
  export_report: "Report Exported",
  delete: "Deleted",
  feedback: "Answer Rated",
};

const AUDIT_PAGE_SIZE = 10;

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [auditExpanded, setAuditExpanded] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const overview = await systemApi.adminOverview(token);
      setData(overview);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadAuditPage = useCallback(async (page) => {
    if (!token) return;
    setAuditLoading(true);
    try {
      const res = await systemApi.adminAudit(token, { page, limit: AUDIT_PAGE_SIZE });
      setAuditData(res);
      setAuditPage(res.page || page);
    } catch (err) {
      setError(err.message);
    } finally {
      setAuditLoading(false);
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

  const handleToggleAudit = () => {
    if (auditExpanded) {
      setAuditExpanded(false);
      setAuditPage(1);
    } else {
      setAuditExpanded(true);
      loadAuditPage(1);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="surface-card empty-box centered-card">
        <LockIcon size={28} />
        <h3>Admin access required</h3>
        <p>Account usage, review quality metrics, and audit logs are only available to administrators.</p>
        <Link to="/security" className="btn btn-primary">Go to Account Settings</Link>
      </div>
    );
  }

  const users = data?.users || { total: 0, roles: {}, accounts: [] };
  const contracts = data?.contracts || {};
  const quality = data?.quality || {};
  const infra = data?.infrastructure || {};
  const previewLogs = data?.auditLogs || [];
  const auditTotal = data?.auditTotal ?? previewLogs.length;

  const visibleLogs = auditExpanded ? (auditData?.entries || previewLogs) : previewLogs.slice(0, 5);
  const totalPages = auditData?.totalPages || Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));

  const aiNodes = infra.aiPool?.nodes || [];
  const healthyNodes = infra.aiPool?.healthyNodes || 0;
  const totalNodes = infra.aiPool?.totalNodes || 0;
  const anyWaking = aiNodes.some((n) => n.status === "waking");

  const feedbackTotal = (quality.feedbackUp || 0) + (quality.feedbackDown || 0);

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Admin Console</h1>
          <p className="page-description">Account overview, review quality, service health, and workspace audit history.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshIcon size={15} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="surface-card state-box"><div className="spinner" /><p>Loading admin overview...</p></div>
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
              <span className="kpi-label">Contracts</span>
              <span className="kpi-value">{contracts.total || 0}</span>
              <span className="kpi-sub">{contracts.analyzed || 0} analyzed · {contracts.totalClauses || 0} clauses</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Answered Questions</span>
              <span className="kpi-value text-accent">
                {quality.totalQuestions ? `${Math.round((quality.groundedCount / quality.totalQuestions) * 100)}%` : "—"}
              </span>
              <span className="kpi-sub">
                {quality.totalQuestions
                  ? `${quality.totalQuestions} queries · avg ${((quality.avgLatencyMs || 0) / 1000).toFixed(2)}s`
                  : "No Q&A queries yet"}
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Answer Helpfulness</span>
              <span className="kpi-value">{quality.helpfulnessRate != null ? `${quality.helpfulnessRate}%` : "—"}</span>
              <span className="kpi-sub">
                {feedbackTotal > 0
                  ? `${quality.feedbackUp || 0} helpful · ${quality.feedbackDown || 0} needs review`
                  : "No ratings yet (rated in contract Q&A)"}
              </span>
            </div>
          </div>

          <section className="surface-card settings-card">
            <div className="section-head-row">
              <span className="section-eyebrow"><ServerIcon size={14} /> Cluster &amp; Service Health</span>
              <div className="row-actions">
                <span className={`risk-pill ${healthyNodes === totalNodes && totalNodes > 0 ? "risk-low" : anyWaking ? "risk-medium" : "risk-high"}`}>
                  {healthyNodes === totalNodes && totalNodes > 0
                    ? `${healthyNodes}/${totalNodes} AI Nodes Healthy`
                    : anyWaking
                      ? "AI Node Waking Up"
                      : `${healthyNodes}/${totalNodes} AI Nodes Healthy`}
                </span>
                {healthyNodes < totalNodes && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                    <RefreshIcon size={13} /> Recheck
                  </button>
                )}
              </div>
            </div>
            <div className="infra-grid">
              <div className="infra-stat">
                <span className="kpi-label">Database</span>
                <strong className="infra-value"><CheckCircleIcon size={14} className="text-accent" /> {infra.database || "connected"}</strong>
                <span className="mono-caption">MongoDB</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Document Storage</span>
                <strong className="infra-value">{(infra.storage || "local").toUpperCase()}</strong>
                <span className="mono-caption">Active file store</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Cache &amp; Limits</span>
                <strong className="infra-value">{infra.redis?.connected ? "Connected" : infra.redis?.mode || "Memory"}</strong>
                <span className="mono-caption">Redis store</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Analysis Queue</span>
                <strong className="infra-value">{infra.queue?.active || 0} active · {infra.queue?.queued || 0} queued</strong>
                <span className="mono-caption">{infra.queue?.completed || 0} completed</span>
              </div>
            </div>

            {aiNodes.length > 0 && (
              <div className="node-list">
                {aiNodes.map((node, i) => (
                  <div key={node.url || i} className="node-row">
                    <div className="node-left">
                      <span className={`health-dot ${node.reachable ? "health-ok" : "health-degraded"}`} />
                      <div>
                        <strong>AI Worker {aiNodes.length > 1 ? `#${i + 1}` : ""}</strong>
                        <div className="mono-caption">
                          {node.reachable
                            ? `Model: ${node.llmProvider || "ready"} · Embeddings: ${node.embeddingProvider || "ready"}`
                            : node.status === "waking"
                              ? "Service is waking up from idle — click Recheck in a few seconds."
                              : node.error || "Unable to reach AI service."}
                        </div>
                      </div>
                    </div>
                    <div className="node-right">
                      <span className={`risk-pill ${node.reachable ? "risk-low" : node.status === "waking" ? "risk-medium" : "risk-high"}`}>
                        {node.reachable ? "HEALTHY" : node.status === "waking" ? "STARTING" : "OFFLINE"}
                      </span>
                      {node.latencyMs !== undefined && <span className="mono-caption">{node.latencyMs}ms</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                <span className="mono-caption">
                  {auditExpanded ? `Page ${auditPage} of ${totalPages} (${auditTotal} total)` : `Showing ${visibleLogs.length} of ${auditTotal}`}
                </span>
              </div>

              {auditLoading ? (
                <div className="state-box"><div className="spinner" /><p>Loading audit entries...</p></div>
              ) : visibleLogs.length === 0 ? (
                <p className="muted-caption">No activity recorded yet.</p>
              ) : (
                <>
                  <div className="audit-list">
                    {visibleLogs.map((entry) => (
                      <div key={entry._id} className="audit-row">
                        <span className="mono-tag">{ACTION_LABELS[entry.action] || entry.action}</span>
                        <span className="audit-summary" title={entry.summary}>
                          {entry.user?.email ? `${entry.user.email}: ` : ""}{entry.summary}
                        </span>
                        <span className="mono-caption">{fmtDate(entry.createdAt)}</span>
                      </div>
                    ))}
                  </div>

                  {auditTotal > 5 && (
                    <div className="audit-footer-bar">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleToggleAudit}>
                        {auditExpanded ? "Show less" : `Show more (${auditTotal})`}
                      </button>

                      {auditExpanded && totalPages > 1 && (
                        <div className="pagination-controls">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={auditPage <= 1 || auditLoading}
                            onClick={() => loadAuditPage(auditPage - 1)}
                          >
                            Previous
                          </button>
                          <span className="mono-caption">
                            Page {auditPage} / {totalPages}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={auditPage >= totalPages || auditLoading}
                            onClick={() => loadAuditPage(auditPage + 1)}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </PageReveal>
  );
}
