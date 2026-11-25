import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi, systemApi, teamApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  CheckCircleIcon, ClockIcon, LayersIcon, LockIcon, LogOutIcon,
  PlusIcon, RefreshIcon, ServerIcon, ShieldCheckIcon, TrashIcon,
} from "../components/Icons";

const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: "", tone: "" };
  const score = [pw.length >= 8, pw.length >= 12, /[a-zA-Z]/.test(pw) && /\d/.test(pw), /[^a-zA-Z0-9]/.test(pw)].filter(Boolean).length;
  return score <= 1
    ? { score: 1, label: "Weak", tone: "high" }
    : score === 2
      ? { score: 2, label: "Fair", tone: "medium" }
      : { score, label: score === 3 ? "Strong" : "Very Strong", tone: "low" };
}

export default function SecuritySettings() {
  const { user, token, login, updateUser, logoutAll } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [profile, setProfile] = useState({ name: user?.name || "", organization: user?.organization || "Personal Workspace" });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [invite, setInvite] = useState({ email: "", role: "reviewer" });
  const [joinCode, setJoinCode] = useState(() => searchParams.get("invite") || "");
  const [busy, setBusy] = useState({});
  const [msg, setMsg] = useState({});
  const [sessions, setSessions] = useState([]);
  const [sysStatus, setSysStatus] = useState(null);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, st, t] = await Promise.all([
        authApi.sessions(token).catch(() => ({ sessions: [] })),
        systemApi.status(token).catch(() => null),
        teamApi.get(token).catch(() => null),
      ]);
      setSessions(s.sessions || []);
      setSysStatus(st);
      if (t?.organization) setTeam(t.organization);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([
      authApi.sessions(token).catch(() => ({ sessions: [] })),
      systemApi.status(token).catch(() => null),
      teamApi.get(token).catch(() => null),
    ])
      .then(([s, st, t]) => {
        if (!active) return;
        setSessions(s.sessions || []);
        setSysStatus(st);
        if (t?.organization) {
          setTeam(t.organization);
          if (user && (user.role !== t.organization.myRole || user.organizationId !== t.organization.id)) {
            updateUser({ ...user, role: t.organization.myRole, organizationId: t.organization.id, organization: t.organization.name });
          }
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const runAction = async (key, fn, onSuccess) => {
    setBusy((b) => ({ ...b, [key]: true }));
    setMsg((m) => ({ ...m, [key]: null }));
    try {
      const res = await fn();
      onSuccess?.(res);
    } catch (err) {
      setMsg((m) => ({ ...m, [key]: { tone: "error", text: err.message } }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const saveProfile = (e) => {
    e.preventDefault();
    runAction("profile", () => authApi.updateProfile(token, profile), (res) => {
      if (res.user) updateUser(res.user);
      setMsg((m) => ({ ...m, profile: { tone: "success", text: "Profile updated." } }));
    });
  };

  const changePassword = (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      return setMsg((m) => ({ ...m, pw: { tone: "error", text: "Passwords do not match." } }));
    }
    runAction("pw", () => authApi.changePassword(token, { currentPassword: pw.current, newPassword: pw.next }), (res) => {
      if (res.token && res.user) login(res.user, res.token);
      setPw({ current: "", next: "", confirm: "" });
      setMsg((m) => ({ ...m, pw: { tone: "success", text: "Password updated and other sessions revoked." } }));
      fetchAll();
    });
  };

  const inviteMember = (e) => {
    e.preventDefault();
    if (!invite.email.trim()) return;
    runAction("team", () => teamApi.invite(token, { email: invite.email.trim(), role: invite.role }), (res) => {
      setInvite((i) => ({ ...i, email: "" }));
      setMsg((m) => ({ ...m, team: { tone: "success", text: res.message } }));
      fetchAll();
    });
  };

  const joinWorkspace = (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    runAction("team", () => teamApi.join(token, joinCode.trim()), (res) => {
      setJoinCode("");
      setMsg((m) => ({ ...m, team: { tone: "success", text: res.message } }));
      fetchAll();
    });
  };

  const revokeSession = (id) =>
    runAction(`rev-${id}`, () => authApi.revokeSession(token, id), () =>
      setSessions((prev) => prev.filter((s) => s.id !== id))
    );

  const strength = passwordStrength(pw.next);

  return (
    <div className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Account, Team &amp; Security</h1>
          <p className="page-description">Workspace identity, team RBAC, credential rotation, sessions, and live cluster health.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={fetchAll}>
          <RefreshIcon size={15} /> Refresh
        </button>
      </div>

      <div className="settings-grid">
        <section className="surface-card settings-card">
          <div className="section-head-row">
            <span className="section-eyebrow"><ShieldCheckIcon size={14} /> Profile &amp; Identity</span>
            <span className="mono-tag">{(team?.myRole || user?.role || "reviewer").toUpperCase()}</span>
          </div>
          {msg.profile && <div className={`alert alert-${msg.profile.tone}`}>{msg.profile.text}</div>}
          <form onSubmit={saveProfile} className="settings-form">
            <div className="field">
              <label htmlFor="sec-name" className="field-label">Full name</label>
              <input id="sec-name" className="text-input" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label htmlFor="sec-email" className="field-label">Email address</label>
              <input id="sec-email" className="text-input" value={user?.email || ""} disabled />
            </div>
            <div className="field">
              <label htmlFor="sec-org" className="field-label">Workspace / Organization</label>
              <input id="sec-org" className="text-input" value={profile.organization} onChange={(e) => setProfile((p) => ({ ...p, organization: e.target.value }))} placeholder="e.g., Acme Legal Ops" />
            </div>
            <div className="settings-form-foot">
              <span className="mono-caption">Last sign-in: {fmtTime(user?.lastLoginAt)}</span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy.profile}>{busy.profile ? "Saving..." : "Save changes"}</button>
            </div>
          </form>
        </section>

        <section className="surface-card settings-card">
          <div className="section-head-row">
            <span className="section-eyebrow"><LockIcon size={14} /> Password &amp; Token Rotation</span>
            <span className="mono-caption">bcrypt-12 + HS256</span>
          </div>
          {msg.pw && <div className={`alert alert-${msg.pw.tone}`}>{msg.pw.text}</div>}
          <form onSubmit={changePassword} className="settings-form">
            <div className="field">
              <label htmlFor="pw-curr" className="field-label">Current password</label>
              <input id="pw-curr" type="password" className="text-input" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} required />
            </div>
            <div className="field">
              <label htmlFor="pw-new" className="field-label">New password</label>
              <input id="pw-new" type="password" className="text-input" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} placeholder="Min 8 chars with letters & numbers" required />
              {pw.next && (
                <div className="strength-row">
                  <div className="strength-bars">
                    {[1, 2, 3, 4].map((n) => (
                      <span key={n} className={`strength-seg ${strength.score >= n ? `seg-${strength.tone}` : ""}`} />
                    ))}
                  </div>
                  <span className="mono-caption">{strength.label}</span>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="pw-confirm" className="field-label">Confirm new password</label>
              <input id="pw-confirm" type="password" className="text-input" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required />
            </div>
            <div className="settings-form-foot">
              <span className="muted-caption">Signs out all other devices automatically.</span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy.pw}>{busy.pw ? "Updating..." : "Update password"}</button>
            </div>
          </form>
        </section>
      </div>

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow"><LayersIcon size={14} /> Organization Workspace &amp; Team RBAC</span>
            <p className="muted-caption">{team ? `${team.name} · ${team.memberCount} member(s)` : "Share contracts with Admin, Counsel, and Reviewer roles."}</p>
          </div>
          {team?.inviteCode && <span className="mono-tag">Invite code: {team.inviteCode}</span>}
        </div>
        {msg.team && <div className={`alert alert-${msg.team.tone}`}>{msg.team.text}</div>}

        {team && (
          <div className="session-list">
            {(team.members || []).map((m) => (
              <div key={m.userId} className="session-row">
                <div className="session-info">
                  <div className="session-title-line">
                    <strong>{m.name}</strong>
                    {m.isOwner && <span className="mono-tag">OWNER</span>}
                  </div>
                  <span className="mono-caption">{m.email}</span>
                </div>
                <div className="row-actions">
                  {team.myRole === "admin" && !m.isOwner ? (
                    <>
                      <select
                        className="select-compact"
                        value={m.role}
                        aria-label={`Role for ${m.name}`}
                        onChange={(e) => runAction("team", () => teamApi.updateRole(token, m.userId, e.target.value), fetchAll)}
                      >
                        <option value="reviewer">Reviewer</option>
                        <option value="counsel">Counsel</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => runAction("team", () => teamApi.removeMember(token, m.userId), fetchAll)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="mono-tag">{m.role.toUpperCase()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="settings-grid">
          {team?.myRole === "admin" && (
            <form onSubmit={inviteMember} className="qa-form">
              <input type="email" className="text-input" placeholder="colleague@company.com" value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} required />
              <select className="select-compact" value={invite.role} onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}>
                <option value="reviewer">Reviewer</option>
                <option value="counsel">Counsel</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy.team}><PlusIcon size={14} /> Invite</button>
            </form>
          )}
          <form onSubmit={joinWorkspace} className="qa-form">
            <input className="text-input" placeholder="Enter teammate invite code..." value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy.team || !joinCode.trim()}>Join Team</button>
          </form>
        </div>
      </section>

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow"><ClockIcon size={14} /> Active Sessions ({sessions.length})</span>
            <p className="muted-caption">Rotating HttpOnly refresh token families with replay theft detection.</p>
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={async () => { await logoutAll(); navigate("/login"); }}>
            <LogOutIcon size={14} /> Sign out all devices
          </button>
        </div>
        {loading ? (
          <div className="state-box"><div className="spinner" /><p>Loading sessions...</p></div>
        ) : sessions.length === 0 ? (
          <p className="muted-caption">No active refresh sessions recorded.</p>
        ) : (
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                <div className="session-info">
                  <div className="session-title-line">
                    <strong>{s.device}</strong>
                    {s.current && <span className="risk-pill risk-low">CURRENT</span>}
                  </div>
                  <span className="mono-caption">IP: {s.ipAddress} · Last active {fmtTime(s.lastUsedAt)} · Expires {fmtTime(s.expiresAt)}</span>
                </div>
                {!s.current && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => revokeSession(s.id)} disabled={busy[`rev-${s.id}`]}>
                    <TrashIcon size={13} /> {busy[`rev-${s.id}`] ? "Revoking..." : "Revoke"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-card settings-card">
        <div className="section-head-row">
          <div>
            <span className="section-eyebrow"><ServerIcon size={14} /> Infrastructure &amp; Load-Balancer Telemetry</span>
            <p className="muted-caption">Storage backend, Redis rate-limit store, async worker queue, and AI circuit breakers.</p>
          </div>
          {sysStatus && <span className="mono-tag">API v{sysStatus.version}</span>}
        </div>
        {loading ? (
          <div className="state-box"><div className="spinner" /><p>Probing services...</p></div>
        ) : !sysStatus ? (
          <p className="muted-caption">Telemetry currently unavailable.</p>
        ) : (
          <>
            <div className="infra-grid">
              <div className="infra-stat">
                <span className="kpi-label">Database &amp; Storage</span>
                <strong className="infra-value"><CheckCircleIcon size={14} className="text-accent" /> MongoDB · {(sysStatus.storage?.provider || "local").toUpperCase()}</strong>
                <span className="mono-caption">Redis: {sysStatus.redis?.connected ? "Connected" : sysStatus.redis?.mode || "Memory"}</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">AI Worker Pool</span>
                <strong className="infra-value">{sysStatus.aiPool?.healthyNodes || 0} / {sysStatus.aiPool?.totalNodes || 0} Healthy</strong>
                <span className="mono-caption">{sysStatus.aiPool?.strategy}</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Async Job Queue</span>
                <strong className="infra-value">{sysStatus.queue?.active || 0} active · {sysStatus.queue?.queued || 0} queued</strong>
                <span className="mono-caption">{sysStatus.queue?.completed || 0} completed (max {sysStatus.queue?.maxConcurrency || 3})</span>
              </div>
              <div className="infra-stat">
                <span className="kpi-label">Service Auth</span>
                <strong className="infra-value">Tenant-Scoped RBAC</strong>
                <span className="mono-caption">Internal key: {sysStatus.security?.serviceAuth ? "Enforced" : "Dev mode"}</span>
              </div>
            </div>
            {sysStatus.aiPool?.nodes?.length > 0 && (
              <div className="node-list">
                {sysStatus.aiPool.nodes.map((node, i) => (
                  <div key={node.url || i} className="node-row">
                    <div className="node-left">
                      <span className={`health-dot ${node.reachable ? "health-ok" : "health-degraded"}`} />
                      <div>
                        <strong className="mono-inline">{node.url}</strong>
                        <div className="mono-caption">LLM: {node.llmProvider || "n/a"} · Embeddings: {node.embeddingProvider || "n/a"}</div>
                      </div>
                    </div>
                    <div className="node-right">
                      <span className={`risk-pill ${node.circuitState === "CLOSED" ? "risk-low" : "risk-high"}`}>CIRCUIT: {node.circuitState}</span>
                      {node.latencyMs !== undefined && <span className="mono-caption">{node.latencyMs}ms</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
