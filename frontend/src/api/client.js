import { API_BASE_URL } from "../config/api";

async function request(path, { method = "GET", token, body, isFormData = false } = {}) {
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
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error("Unable to reach the API server. Make sure the backend is running on port 5000.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      (typeof payload === "object" && (payload.message || payload.detail)) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export const authApi = {
  login: (credentials) => request("/api/auth/login", { method: "POST", body: credentials }),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
};

export const contractsApi = {
  list: (token) => request("/api/contracts", { token }),
  get: (token, id) => request(`/api/contracts/${id}`, { token }),
  upload: (token, formData) =>
    request("/api/contracts/upload", { method: "POST", token, body: formData, isFormData: true }),
  extract: (token, id) => request(`/api/contracts/${id}/extract`, { method: "POST", token }),
  clauses: (token, id) => request(`/api/contracts/${id}/clauses`, { token }),
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
  downloadReport: async (token, id, filename) => {
    const res = await fetch(`${API_BASE_URL}/api/contracts/${id}/report`, {
      headers: { Authorization: `Bearer ${token}` },
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

export const feedbackApi = {
  submit: (token, payload) => request("/api/feedback", { method: "POST", token, body: payload }),
  stats: (token) => request("/api/feedback/stats", { token }),
};

export const analyticsApi = {
  overview: (token) => request("/api/analytics/overview", { token }),
};
