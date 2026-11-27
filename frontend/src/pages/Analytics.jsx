import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { analyticsApi, contractsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { AlertTriangleIcon, BarChartIcon, CalendarIcon, PlusIcon, RefreshIcon, ShieldAlertIcon } from "../components/Icons";
import { AnimatedNumber, PageReveal, StaggerContainer, StaggerItem } from "../components/Motion";
import { EASE_EDITORIAL } from "../components/motionTokens";

export default function Analytics() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [exportingIcs, setExportingIcs] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await analyticsApi.overview(token));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    analyticsApi.overview(token)
      .then((res) => active && (setData(res), setError(null)))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const handleExportIcs = async () => {
    if (exportingIcs) return;
    setExportingIcs(true);
    try {
      await contractsApi.downloadDeadlinesIcs(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingIcs(false);
    }
  };

  const portfolio = data?.portfolio || {};
  const dist = data?.riskDistribution || { high: 0, medium: 0, low: 0 };
  const qa = data?.qaMetrics || {};
  const categories = data?.topCategories || [];
  const missing = data?.missingProtections || [];
  const obligations = data?.portfolioObligations || [];
  const loopholeCats = data?.topLoopholeCategories || [];

  const totalRisk = dist.high + dist.medium + dist.low;
  const maxCat = Math.max(1, ...categories.map((c) => c.total));
  const C = 263.89;
  const lowArc = totalRisk ? (dist.low / totalRisk) * C : 0;
  const medArc = totalRisk ? (dist.medium / totalRisk) * C : 0;
  const highArc = totalRisk ? (dist.high / totalRisk) * C : 0;

  return (
    <PageReveal className="workspace-page">
      <div className="page-header">
        <div>
          <h1 className="page-heading">Risk &amp; Portfolio Analytics</h1>
          <p className="page-description">Portfolio health scores, loophole density, upcoming obligation deadlines, missing protections, and research metrics.</p>
        </div>
        <div className="page-header-actions">
          {obligations.length > 0 && (
            <button type="button" className="btn btn-secondary" onClick={handleExportIcs} disabled={exportingIcs}>
              <CalendarIcon size={15} /> {exportingIcs ? "Exporting..." : "Export Deadlines (.ics)"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshIcon size={15} /> Refresh
          </button>
          <Link to="/upload" className="btn btn-primary"><PlusIcon size={15} /> Upload Contract</Link>
        </div>
      </div>

      {loading ? (
        <div className="surface-card state-box"><div className="spinner" /><p>Loading portfolio analytics...</p></div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : portfolio.totalContracts === 0 ? (
        <div className="surface-card empty-box">
          <BarChartIcon size={26} />
          <h3>No analytics data yet</h3>
          <p>Upload and analyze your first contract to view health scorecards, loophole trends, deadlines, and missing protections.</p>
          <Link to="/upload" className="btn btn-primary">Upload Contract</Link>
        </div>
      ) : (
        <>
          <StaggerContainer className="kpi-grid" stagger={0.04}>
            <StaggerItem className="kpi-card">
              <span className="kpi-label">Avg Contract Health</span>
              <span className={`kpi-value ${(portfolio.avgHealthScore ?? 100) < 55 ? "text-danger" : (portfolio.avgHealthScore ?? 100) < 75 ? "text-warn" : "text-accent"}`}>
                <AnimatedNumber value={portfolio.avgHealthScore ?? Math.max(0, 100 - (portfolio.avgRiskScore || 0))} /><small className="kpi-unit">/100</small>
              </span>
              <span className="kpi-sub">Avg risk: {portfolio.avgRiskScore || 0}/100 · {portfolio.analyzedContracts} docs</span>
            </StaggerItem>
            <StaggerItem className="kpi-card">
              <span className="kpi-label">Loophole Tightness</span>
              <span className={`kpi-value ${(portfolio.avgLoopholeScore ?? 100) < 60 ? "text-danger" : (portfolio.avgLoopholeScore ?? 100) < 80 ? "text-warn" : "text-accent"}`}>
                {portfolio.avgLoopholeScore != null ? <><AnimatedNumber value={portfolio.avgLoopholeScore} /><small className="kpi-unit">/100</small></> : "—"}
              </span>
              <span className="kpi-sub">{portfolio.totalLoopholes || 0} drafting loopholes tracked</span>
            </StaggerItem>
            <StaggerItem className="kpi-card">
              <span className="kpi-label">User Side Protection</span>
              <span className="kpi-value">
                {portfolio.avgUserFavorability != null ? <><AnimatedNumber value={portfolio.avgUserFavorability} /><small className="kpi-unit">/100</small></> : "—"}
              </span>
              <span className="kpi-sub">{portfolio.totalClauses} reviewed clauses across portfolio</span>
            </StaggerItem>
            <StaggerItem className="kpi-card">
              <span className="kpi-label">Cited Q&amp;A Grounding</span>
              <span className="kpi-value">
                <AnimatedNumber value={qa.groundedCount || 0} /><small className="kpi-unit">/{qa.totalQuestions || 0}</small>
              </span>
              <span className="kpi-sub">
                {qa.helpfulnessRate != null
                  ? `${qa.helpfulnessRate}% helpful · ${qa.refusalCount || 0} out-of-scope declined`
                  : `${qa.refusalCount || 0} declined when absent in text`}
              </span>
            </StaggerItem>
          </StaggerContainer>

          <div className="analytics-grid">
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">Clause Risk Distribution</span>
                <span className="mono-caption">{totalRisk} total</span>
              </div>
              <div className="donut-layout">
                <svg className="donut-svg" viewBox="0 0 110 110" role="img" aria-label="Risk distribution donut chart">
                  <circle cx="55" cy="55" r="42" fill="none" stroke="var(--border)" strokeWidth="13" />
                  {totalRisk > 0 && (
                    <>
                      <motion.circle
                        cx="55" cy="55" r="42" fill="none" stroke="var(--risk-low-solid)" strokeWidth="13"
                        initial={{ strokeDasharray: `0 ${C}` }}
                        animate={{ strokeDasharray: `${lowArc} ${C}` }}
                        transition={{ duration: 0.55, ease: EASE_EDITORIAL }}
                        strokeDashoffset={0} transform="rotate(-90 55 55)"
                      />
                      <motion.circle
                        cx="55" cy="55" r="42" fill="none" stroke="var(--risk-med-solid)" strokeWidth="13"
                        initial={{ strokeDasharray: `0 ${C}` }}
                        animate={{ strokeDasharray: `${medArc} ${C}` }}
                        transition={{ duration: 0.55, delay: 0.08, ease: EASE_EDITORIAL }}
                        strokeDashoffset={-lowArc} transform="rotate(-90 55 55)"
                      />
                      <motion.circle
                        cx="55" cy="55" r="42" fill="none" stroke="var(--risk-high-solid)" strokeWidth="13"
                        initial={{ strokeDasharray: `0 ${C}` }}
                        animate={{ strokeDasharray: `${highArc} ${C}` }}
                        transition={{ duration: 0.55, delay: 0.16, ease: EASE_EDITORIAL }}
                        strokeDashoffset={-(lowArc + medArc)} transform="rotate(-90 55 55)"
                      />
                    </>
                  )}
                  <text x="55" y="52" textAnchor="middle" className="donut-number">{portfolio.analyzedContracts}</text>
                  <text x="55" y="66" textAnchor="middle" className="donut-sub">analyzed</text>
                </svg>
                <div className="donut-legend">
                  {[["high", "High Risk", dist.high], ["medium", "Medium Risk", dist.medium], ["low", "Low Risk", dist.low]].map(([k, label, val]) => (
                    <div key={k} className="legend-row">
                      <span className={`legend-dot seg-${k}`} />
                      <span className="legend-label">{label}</span>
                      <span className="mono-caption">{val}</span>
                    </div>
                  ))}
                  {qa.avgLatencyMs > 0 && (
                    <div className="legend-foot">Avg Q&amp;A latency: <strong>{(qa.avgLatencyMs / 1000).toFixed(2)}s</strong></div>
                  )}
                </div>
              </div>
            </section>

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
                        <span className="mono-caption">{cat.high}H · {cat.medium}M · {cat.low}L</span>
                      </div>
                      <div className="cat-track">
                        <motion.div
                          className="cat-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${(cat.total / maxCat) * 100}%` }}
                          transition={{ duration: 0.45, ease: EASE_EDITORIAL }}
                        >
                          <span className="seg-high" style={{ width: `${(cat.high / cat.total) * 100}%` }} />
                          <span className="seg-medium" style={{ width: `${(cat.medium / cat.total) * 100}%` }} />
                          <span className="seg-low" style={{ width: `${(cat.low / cat.total) * 100}%` }} />
                        </motion.div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {loopholeCats.length > 0 && (
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow"><ShieldAlertIcon size={14} /> Recurring Drafting Loopholes</span>
                <span className="mono-caption">{portfolio.totalLoopholes || 0} total findings</span>
              </div>
              <div className="missing-list">
                {loopholeCats.map((l) => (
                  <div key={l.category} className="missing-item">
                    <div className="missing-item-head">
                      <span className="missing-item-title">{l.category}</span>
                      <span className="risk-pill risk-medium">{l.count} {l.count === 1 ? "instance" : "instances"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {obligations.length > 0 && (
            <section className="surface-card analytics-card">
              <div className="section-head-row">
                <span className="section-eyebrow">Portfolio Obligations &amp; Deadlines Ledger</span>
                <div className="row-actions">
                  <span className="mono-caption">{obligations.length} tracked</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportIcs} disabled={exportingIcs}>
                    <CalendarIcon size={13} /> Calendar (.ics)
                  </button>
                </div>
              </div>
              <div className="obligations-table-wrap">
                <table className="obligations-table">
                  <thead>
                    <tr>
                      <th>Contract</th>
                      <th>Party</th>
                      <th>Obligation</th>
                      <th>Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obligations.map((ob, idx) => (
                      <tr key={idx}>
                        <td className="obligation-party">{ob.contractTitle}</td>
                        <td>{ob.party}</td>
                        <td>{ob.obligation}</td>
                        <td className="obligation-deadline">{ob.deadline}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="surface-card analytics-card">
            <div className="section-head-row">
              <span className="section-eyebrow">Recurring Missing Protections</span>
              <span className="mono-caption">Across analyzed docs</span>
            </div>
            {missing.length === 0 ? (
              <p className="muted-caption">No recurring missing clauses flagged.</p>
            ) : (
              <div className="missing-list">
                {missing.map((m) => (
                  <div key={m.clauseType} className="missing-item">
                    <div className="missing-item-head">
                      <span className="missing-item-title"><AlertTriangleIcon size={14} /> {m.clauseType}</span>
                      <span className={`risk-pill risk-${m.severity}`}>Missing in {m.count} {m.count === 1 ? "contract" : "contracts"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </PageReveal>
  );
}
