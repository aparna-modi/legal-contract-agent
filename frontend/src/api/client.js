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

const SAFE_RETRY_NON_GET_PREFIXES = [
  "/api/contracts/draft",
  "/api/contracts/compare",
  "/api/contracts/search",
  "/api/contracts/clauses/redline-adhoc",
  "/api/contracts/export-docx",
  "/api/playbook/evaluate",
  "/api/playbook/generate-rules",
  "/api/baselines",
  "/api/system/warmup",
];

function isSafeToRetryGatewayError(path, method) {
  if (method === "GET") return true;
  if (path === "/api/contracts/draft/save" || path === "/api/contracts/upload") return false;
  if (/^\/api\/contracts\/[^/]+\/(ask|draft-missing-clause|clauses\/[^/]+\/suggest-redline|loopholes|rewrite-user-only|case-strategy|legal-notice|negotiation-email)$/.test(path)) {
    return true;
  }
  return SAFE_RETRY_NON_GET_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

async function fetchWithAuth(
  path,
  { method = "GET", token, headers = {}, body, _retried = false, _gatewayRetried = false } = {}
) {
  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      credentials: "include",
      body,
    });
  } catch {
    if (!_gatewayRetried && isSafeToRetryGatewayError(path, method)) {
      await new Promise((r) => setTimeout(r, 2500));
      return fetchWithAuth(path, { method, token, headers, body, _retried, _gatewayRetried: true });
    }
    throw new Error("Unable to reach the API server. Please check your connection and try again.");
  }

  if ([502, 503, 504].includes(response.status) && !_gatewayRetried && isSafeToRetryGatewayError(path, method)) {
    await new Promise((r) => setTimeout(r, 2500));
    return fetchWithAuth(path, { method, token, headers, body, _retried, _gatewayRetried: true });
  }

  const skipRefreshPaths = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ];
  const shouldRefresh =
    response.status === 401 &&
    token &&
    !_retried &&
    !skipRefreshPaths.some((p) => path.startsWith(p));

  if (shouldRefresh) {
    const freshToken = await attemptSilentRefresh();
    if (freshToken) {
      return fetchWithAuth(path, { method, token: freshToken, headers, body, _retried: true, _gatewayRetried });
    }
    onAuthExpired?.();
  }

  return response;
}

async function request(path, { method = "GET", token, body, isFormData = false } = {}) {
  const headers = {};
  if (body && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithAuth(path, {
    method,
    token,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

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
  suggestRedline: (token, contractId, clauseId, options = {}) =>
    request(`/api/contracts/${contractId}/clauses/${clauseId}/suggest-redline`, {
      method: "POST",
      token,
      body: options,
    }),
  suggestAdhocRedline: (token, payload) =>
    request("/api/contracts/clauses/redline-adhoc", {
      method: "POST",
      token,
      body: payload,
    }),
  draftMissingClause: (token, contractId, payload) =>
    request(`/api/contracts/${contractId}/draft-missing-clause`, {
      method: "POST",
      token,
      body: payload,
    }),
  risks: (token, id) => request(`/api/contracts/${id}/risks`, { token }),
  qaHistory: (token, id) => request(`/api/contracts/${id}/qa`, { token }),
  summary: (token, id) => request(`/api/contracts/${id}/summary`, { token }),
  ask: (token, id, query, history = [], qaMode = "facts") =>
    request(`/api/contracts/${id}/ask`, {
      method: "POST",
      token,
      body: { query, top_k: 6, min_score: 0.20, history, qaMode },
    }),
  setPerspective: (token, id, payload) =>
    request(`/api/contracts/${id}/perspective`, { method: "PATCH", token, body: payload }),
  auditLoopholes: (token, id, payload = {}) =>
    request(`/api/contracts/${id}/loopholes`, { method: "POST", token, body: payload }),
  rewriteUserOnly: (token, id, payload = {}) =>
    request(`/api/contracts/${id}/rewrite-user-only`, { method: "POST", token, body: payload }),
  caseStrategy: (token, id, payload = {}) =>
    request(`/api/contracts/${id}/case-strategy`, { method: "POST", token, body: payload }),
  legalNotice: (token, id, payload = {}) =>
    request(`/api/contracts/${id}/legal-notice`, { method: "POST", token, body: payload }),
  negotiationEmail: (token, id, payload = {}) =>
    request(`/api/contracts/${id}/negotiation-email`, { method: "POST", token, body: payload }),
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
  draftTemplates: (token) => request("/api/contracts/draft/templates", { token }),
  draft: (token, payload) =>
    request("/api/contracts/draft", { method: "POST", token, body: payload }),
  reviseDraft: (token, payload) =>
    request("/api/contracts/draft/revise", { method: "POST", token, body: payload }),
  auditDraftLoopholes: (token, payload) =>
    request("/api/contracts/draft/audit-loopholes", { method: "POST", token, body: payload }),
  hardenDraft: (token, payload) =>
    request("/api/contracts/draft/harden", { method: "POST", token, body: payload }),
  standardizeBaseline: (token, payload) =>
    request("/api/contracts/draft/standardize-baseline", { method: "POST", token, body: payload }),
  saveDraft: (token, payload) =>
    request("/api/contracts/draft/save", { method: "POST", token, body: payload }),
  downloadDocx: async (token, payload, filename = "contract") => {
    const res = await fetchWithAuth("/api/contracts/export-docx", {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || "Could not generate Word (.docx) export.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(filename || "contract").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60)}.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  downloadDeadlinesIcs: async (token, contractId = null, filename = "contract_deadlines") => {
    const path = contractId ? `/api/contracts/${contractId}/deadlines.ics` : "/api/contracts/deadlines/calendar.ics";
    const res = await fetchWithAuth(path, { token });
    if (!res.ok) throw new Error("Could not export deadlines calendar.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(filename).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50)}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  vectorStats: (token) => request("/api/contracts/stats/vectors", { token }),
  remove: (token, id) => request(`/api/contracts/${id}`, { method: "DELETE", token }),
  fetchFileBlobUrl: async (token, id) => {
    const res = await fetchWithAuth(`/api/contracts/${id}/file`, { token });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.message || "Could not load source document preview.");
    }
    const contentType = res.headers.get("content-type") || "application/pdf";
    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], { type: contentType });
    return URL.createObjectURL(blob);
  },
  downloadReport: async (token, id, filename) => {
    const res = await fetchWithAuth(`/api/contracts/${id}/report`, { token });
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
  generateRules: (token, payload) =>
    request("/api/playbook/generate-rules", { method: "POST", token, body: payload }),
  evaluate: (token, contractId, options = { useAiAudit: true }) =>
    request(`/api/playbook/evaluate/${contractId}`, { method: "POST", token, body: options }),
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

export const baselinesApi = {
  list: (token) => request("/api/baselines", { token }),
  save: (token, payload) => request("/api/baselines", { method: "POST", token, body: payload }),
  remove: (token, id) => request(`/api/baselines/${id}`, { method: "DELETE", token }),
  benchmark: (token, baselineId, payload) =>
    request(`/api/baselines/${baselineId}/benchmark`, { method: "POST", token, body: payload }),
};

export const clauseBankApi = {
  list: (token) => request("/api/clause-bank", { token }),
  save: (token, payload) => request("/api/clause-bank", { method: "POST", token, body: payload }),
  remove: (token, id) => request(`/api/clause-bank/${id}`, { method: "DELETE", token }),
};

export const systemApi = {
  warmup: (token) => request("/api/system/warmup", { method: "POST", token }),
  status: (token) => request("/api/system/status", { token }),
  adminOverview: (token) => request("/api/system/admin/overview", { token }),
  adminAudit: (token, { page = 1, limit = 10 } = {}) =>
    request(`/api/system/admin/audit?page=${page}&limit=${limit}`, { token }),
};
