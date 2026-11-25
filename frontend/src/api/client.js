import { API_BASE_URL } from "../config/api";

let onTokenRefreshed = null;
let onAuthExpired = null;
let refreshInFlight = null;

export function configureAuthCallbacks({ onRefresh, onExpired } = {}) {
  onTokenRefreshed = onRefresh || null;
  onAuthExpired = onExpired || null;
}

async function attemptSilentRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (data?.token) {
          onTokenRefreshed?.(data.token, data.user);
          return data.token;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request(
  path,
  { method = "GET", token, body, isFormData = false, _retried = false } = {}
) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error("Unable to reach the API server. Make sure the backend is running on port 5000.");
  }

  if (response.status === 401 && token && !_retried && !path.startsWith("/api/auth/")) {
    const freshToken = await attemptSilentRefresh();
    if (freshToken) {
      return request(path, { method, token: freshToken, body, isFormData, _retried: true });
    }
    onAuthExpired?.();
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      (typeof payload === "object" && (payload.message || payload.detail)) ||
      `Request failed with status ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = typeof payload === "object" ? payload.code : undefined;
    throw err;
  }

  return payload;
}

export const authApi = {
  login: (credentials) => request("/api/auth/login", { method: "POST", body: credentials }),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
  refresh: () => request("/api/auth/refresh", { method: "POST" }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  logoutAll: (token) => request("/api/auth/logout-all", { method: "POST", token }),
  me: (token) => request("/api/auth/me", { token }),
  updateProfile: (token, payload) =>
    request("/api/auth/profile", { method: "PATCH", token, body: payload }),
  changePassword: (token, payload) =>
    request("/api/auth/change-password", { method: "POST", token, body: payload }),
  forgotPassword: (email) =>
    request("/api/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (payload) =>
    request("/api/auth/reset-password", { method: "POST", body: payload }),
  sessions: (token) => request("/api/auth/sessions", { token }),
  revokeSession: (token, sessionId) =>
    request(`/api/auth/sessions/${sessionId}`, { method: "DELETE", token }),
};

export const contractsApi = {
  list: (token) => request("/api/contracts", { token }),
  get: (token, id) => request(`/api/contracts/${id}`, { token }),
  upload: (token, formData) =>
    request("/api/contracts/upload", { method: "POST", token, body: formData, isFormData: true }),
  extract: (token, id) => request(`/api/contracts/${id}/extract`, { method: "POST", token }),
  extractAsync: (token, id) =>
    request(`/api/contracts/${id}/extract-async`, { method: "POST", token }),
  jobStatus: (token, jobId) => request(`/api/contracts/jobs/${jobId}`, { token }),
  setVisibility: (token, id, visibility) =>
    request(`/api/contracts/${id}/visibility`, {
      method: "PATCH",
      token,
      body: { visibility },
    }),
  clauses: (token, id) => request(`/api/contracts/${id}/clauses`, { token }),
  suggestRedline: (token, contractId, clauseId) =>
    request(`/api/contracts/${contractId}/clauses/${clauseId}/suggest-redline`, {
      method: "POST",
      token,
    }),
  risks: (token, id) => request(`/api/contracts/${id}/risks`, { token }),
  qaHistory: (token, id) => request(`/api/contracts/${id}/qa`, { token }),
  summary: (token, id) => request(`/api/contracts/${id}/summary`, { token }),
  ask: (token, id, query) =>
    request(`/api/contracts/${id}/ask`, {
      method: "POST",
      token,
      body: { query, top_k: 5, min_score: 0.22 },
    }),
  search: (token, query) =>
    request("/api/contracts/search", {
      method: "POST",
      token,
      body: { query, top_k: 6, min_score: 0.20 },
    }),
  compare: (token, contractAId, contractBId) =>
    request("/api/contracts/compare", {
      method: "POST",
      token,
      body: { contractAId, contractBId },
    }),
  vectorStats: (token) => request("/api/contracts/stats/vectors", { token }),
  remove: (token, id) => request(`/api/contracts/${id}`, { method: "DELETE", token }),
  fetchFileBlobUrl: async (token, id) => {
    const res = await fetch(`${API_BASE_URL}/api/contracts/${id}/file`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Could not load source document preview.");
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  downloadReport: async (token, id, filename) => {
    const res = await fetch(`${API_BASE_URL}/api/contracts/${id}/report`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Could not export contract analysis report.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(filename || "contract").replace(/[^a-zA-Z0-9_-]+/g, "_")}_report.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

export const playbookApi = {
  get: (token) => request("/api/playbook", { token }),
  update: (token, payload) => request("/api/playbook", { method: "PUT", token, body: payload }),
  presets: (token) => request("/api/playbook/presets", { token }),
  applyPreset: (token, presetId) => request(`/api/playbook/presets/${presetId}`, { method: "POST", token }),
  evaluate: (token, contractId) =>
    request(`/api/playbook/evaluate/${contractId}`, { method: "POST", token }),
};

export const teamApi = {
  get: (token) => request("/api/team", { token }),
  invite: (token, payload) => request("/api/team/invite", { method: "POST", token, body: payload }),
  join: (token, inviteCode) =>
    request("/api/team/join", { method: "POST", token, body: { inviteCode } }),
  updateRole: (token, userId, role) =>
    request(`/api/team/members/${userId}/role`, { method: "PATCH", token, body: { role } }),
  removeMember: (token, userId) =>
    request(`/api/team/members/${userId}`, { method: "DELETE", token }),
};

export const feedbackApi = {
  submit: (token, payload) => request("/api/feedback", { method: "POST", token, body: payload }),
  stats: (token) => request("/api/feedback/stats", { token }),
};

export const analyticsApi = {
  overview: (token) => request("/api/analytics/overview", { token }),
};

export const systemApi = {
  status: (token) => request("/api/system/status", { token }),
  adminOverview: (token) => request("/api/system/admin/overview", { token }),
};
