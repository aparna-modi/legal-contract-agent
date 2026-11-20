import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { analyticsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  AlertTriangleIcon,
  BarChartIcon,
  ClockIcon,
  PlusIcon,
} from "../components/Icons";

function formatTimestamp(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_LABELS = {
  upload: "Upload",
  extract: "Analysis",
  ask: "Contract Q&A",
  search: "Library Search",
  compare: "Comparison",
  export_report: "Report Export",
  delete: "Deletion",
  feedback: "Feedback",
};

export default function Analytics() {
  const { token, isAuthenticated } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    analyticsApi
      .overview(token)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!isAuthenticated) {
    return (
      <div className="surface-card empty-box centered-card">
        <h3>Sign in to view risk analytics</h3>
        <p>Inspect portfolio-wide clause risk distributions, missing protections, and audit logs.</p>
        <Link to="/login" className="btn btn-primary">
          Sign in
        </Link>
      </div>
    );
  }

  const portfolio = data?.portfolio || {};
  const dist = data?.riskDistribution || { high: 0, medium: 0, low: 0 };
  const qa = data?.qaMetrics || {};
  const categories = data?.topCategories || [];
  const missing = data?.missingProtections || [];
  const activity = data?.recentActivity || [];

  const totalRiskClauses = dist.high + dist.medium + dist.low;
  const maxCategoryTotal = Math.max(1, ...categories.map((c) => c.total));

  // Donut chart stroke segments (circumference = 2 * pi * 42 = 263.89)
  const C = 263.89;
  const highArc = totalRiskClauses ? (dist.high / totalRiskClauses) * C : 0;
  const medArc = totalRiskClauses ? (dist.medium / totalRiskClauses) * C : 0;
  const lowArc = totalRiskClauses ? (dist.low / totalRiskClauses) * C : 0;

  return (
    <div className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Risk & Quality Analytics</h1>
          <p className="page-description">
            Portfolio-level clause risk breakdown, recurring missing protections, Q&A quality, and
            audit history.
          </p>
        </div>
        <Link to="/upload" className="btn btn-primary">
          <PlusIcon size={15} />
          Upload Contract
        </Link>
      </div>

      {loading ? (
        <div className="surface-card state-box">
          <div className="spinner" />
          <p>Aggregating portfolio analytics...</p>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : portfolio.totalContracts === 0 ? (
        <div className="surface-card empty-box">
          <BarChartIcon size={28} />
          <h3>No analytics data yet</h3>
          <p>Upload and analyze your first contract to unlock risk charts and audit insights.</p>
          <Link to="/upload" className="btn btn-primary">
            Upload Contract
          </Link>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Average Risk Score</span>
              <span
                className={`kpi-value ${
                  portfolio.avgRiskScore >= 60
                    ? "text-danger"
                    : portfolio.avgRiskScore >= 28
                      ? "text-warn"
                      : ""
                }`}
              >
                {portfolio.avgRiskScore}
                <small className="kpi-unit">/100</small>
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Classified Clauses</span>
              <span className="kpi-value">{portfolio.totalClauses}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Grounded Q&A Queries</span>
              <span className="kpi-value">
                {qa.groundedCount || 0}
                <small className="kpi-unit">/{qa.totalQuestions || 0}</small>
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Reviewer Helpfulness</span>
              <span className="kpi-value text-accent">
                {qa.helpfulnessRate !== null && qa.helpfulnessRate !== undefined
                  ? `${qa.helpfulnessRate}%`
                  : "—"}
              </span>
            </div>
          </div>

          <div className="analytics-grid">
            {/* Donut chart: Portfolio Risk Mix */}
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">Clause Risk Distribution</span>
                <span className="mono-caption">{totalRiskClauses} total</span>
              </div>

              <div className="donut-layout">
                <svg className="donut-svg" viewBox="0 0 110 110" role="img" aria-label="Risk distribution donut chart">
                  <circle cx="55" cy="55" r="42" fill="none" stroke="#f1efe9" strokeWidth="14" />
                  {totalRiskClauses > 0 && (
                    <>
                      <circle
                        cx="55"
                        cy="55"
                        r="42"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="14"
                        strokeDasharray={`${lowArc} ${C}`}
                        strokeDashoffset={0}
                        transform="rotate(-90 55 55)"
                      />
                      <circle
                        cx="55"
                        cy="55"
                        r="42"
                        fill="none"
                        stroke="#d97706"
                        strokeWidth="14"
                        strokeDasharray={`${medArc} ${C}`}
                        strokeDashoffset={-lowArc}
                        transform="rotate(-90 55 55)"
                      />
                      <circle
                        cx="55"
                        cy="55"
                        r="42"
                        fill="none"
                        stroke="#b42318"
                        strokeWidth="14"
                        strokeDasharray={`${highArc} ${C}`}
                        strokeDashoffset={-(lowArc + medArc)}
                        transform="rotate(-90 55 55)"
                      />
                    </>
                  )}
                  <text x="55" y="52" textAnchor="middle" className="donut-number">
                    {portfolio.analyzedContracts}
                  </text>
                  <text x="55" y="66" textAnchor="middle" className="donut-sub">
                    analyzed
                  </text>
                </svg>

                <div className="donut-legend">
                  <div className="legend-row">
                    <span className="legend-dot seg-high" />
                    <span className="legend-label">High Risk</span>
                    <span className="mono-caption">{dist.high}</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-dot seg-medium" />
                    <span className="legend-label">Medium Risk</span>
                    <span className="mono-caption">{dist.medium}</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-dot seg-low" />
                    <span className="legend-label">Low Risk</span>
                    <span className="mono-caption">{dist.low}</span>
                  </div>
                  {qa.avgLatencyMs > 0 && (
                    <div className="legend-foot">
                      Avg Q&A latency: <strong>{(qa.avgLatencyMs / 1000).toFixed(2)}s</strong>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Stacked bar chart: Top Clause Categories */}
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">Risk by Clause Category</span>
                <span className="mono-caption">Top {categories.length}</span>
              </div>

              {categories.length === 0 ? (
                <p className="muted-caption">Analyze a contract to populate category metrics.</p>
              ) : (
                <div className="cat-bars">
                  {categories.map((cat) => (
                    <div key={cat.category} className="cat-bar-row">
                      <div className="cat-bar-head">
                        <span className="cat-bar-name">{cat.category}</span>
                        <span className="mono-caption">
                          {cat.high}H · {cat.medium}M · {cat.low}L
                        </span>
                      </div>
                      <div className="cat-track">
                        <div
                          className="cat-fill"
                          style={{ width: `${(cat.total / maxCategoryTotal) * 100}%` }}
                        >
                          <span
                            className="seg-high"
                            style={{ width: `${(cat.high / cat.total) * 100}%` }}
                          />
                          <span
                            className="seg-medium"
                            style={{ width: `${(cat.medium / cat.total) * 100}%` }}
                          />
                          <span
                            className="seg-low"
                            style={{ width: `${(cat.low / cat.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="analytics-grid">
            {/* Recurring Missing Protections */}
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">Recurring Missing Protections</span>
                <span className="mono-caption">Across analyzed docs</span>
              </div>

              {missing.length === 0 ? (
                <p className="muted-caption">No recurring missing clauses flagged.</p>
              ) : (
                <div className="missing-list">
                  {missing.map((item) => (
                    <div key={item.clauseType} className="missing-item">
                      <div className="missing-item-head">
                        <span className="missing-item-title">
                          <AlertTriangleIcon size={14} />
                          {item.clauseType}
                        </span>
                        <span className={`risk-pill risk-${item.severity}`}>
                          Missing in {item.count} {item.count === 1 ? "contract" : "contracts"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Audit Log / Activity Feed */}
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">
                  <ClockIcon size={13} /> Recent Activity & Audit Trail
                </span>
                <span className="mono-caption">Latest {activity.length}</span>
              </div>

              {activity.length === 0 ? (
                <p className="muted-caption">Activity will appear here as you review contracts.</p>
              ) : (
                <div className="audit-list">
                  {activity.map((entry) => (
                    <div key={entry._id} className="audit-row">
                      <span className="mono-tag">{ACTION_LABELS[entry.action] || entry.action}</span>
                      <span className="audit-summary">{entry.summary}</span>
                      <span className="mono-caption">{formatTimestamp(entry.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
