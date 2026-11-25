import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { contractsApi } from "../api/client";
import FormattedText from "./FormattedText";
import { AlertTriangleIcon, CheckCircleIcon, SearchIcon, XIcon } from "./Icons";
import { EASE_EDITORIAL } from "./motionTokens";

export default function LibrarySearchModal({ initialQuery, token, onClose }) {
  const [query, setQuery] = useState(initialQuery || "");
  const [loading, setLoading] = useState(Boolean(initialQuery && token));
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);

  const runSearch = async (qText) => {
    const cleaned = (qText ?? query).trim();
    if (!cleaned || !token) return;
    setQuery(cleaned);
    setLoading(true);
    setError(null);
    try {
      const data = await contractsApi.search(token, cleaned);
      setResponse(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cleaned = (initialQuery || "").trim();
    if (!cleaned || !token) return;
    let cancelled = false;

    contractsApi
      .search(token, cleaned)
      .then((data) => {
        if (!cancelled) {
          setResponse(data);
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
  }, [initialQuery, token]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Cross-contract semantic search"
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.24, ease: EASE_EDITORIAL }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-modal-head">
          <div>
            <h2>Library Semantic Search</h2>
            <p className="muted-caption">
              Query clauses across every analyzed agreement in your workspace
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <form
          className="qa-form"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <div className="input-with-icon">
            <SearchIcon size={16} />
            <input
              type="text"
              className="text-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search obligations, notice periods, indemnity caps..."
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="search-modal-body">
          {loading && (
            <div className="state-box">
              <div className="spinner" />
              <p>Searching indexed passages across your contracts...</p>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          {!loading && response && (
            <div className="qa-result-stack">
              {response.insufficient_information ? (
                <div className="qa-refusal-box">
                  <div className="qa-refusal-head">
                    <AlertTriangleIcon size={15} />
                    <strong>No strong matches across your library</strong>
                  </div>
                  <p>{response.answer || response.message}</p>
                </div>
              ) : (
                <div className="qa-answer-box">
                  <div className="qa-answer-top">
                    <span className="qa-answer-label">
                      <CheckCircleIcon size={14} />
                      Synthesized Finding
                    </span>
                    {response.confidence && (
                      <span className={`confidence-pill conf-${response.confidence.toLowerCase()}`}>
                        {response.confidence} CONFIDENCE
                      </span>
                    )}
                  </div>
                  <FormattedText text={response.answer} />
                  {response.indian_law_refs?.length > 0 && (
                    <div className="law-ref-stack">
                      <span className="law-ref-badge">Applicable Indian Law</span>
                      <div className="citation-row">
                        {response.indian_law_refs.map((law, idx) => (
                          <span key={idx} className="law-ref-pill">{law}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {response.suggested_followups?.length > 0 && (
                    <div className="followup-row">
                      <span className="chip-prefix">Related queries</span>
                      <div className="prompt-chips">
                        {response.suggested_followups.map((fq, idx) => (
                          <button key={idx} type="button" className="chip-btn" onClick={() => runSearch(fq)}>
                            {fq}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {response.results && response.results.length > 0 && (
                <div className="evidence-list">
                  {response.results.map((item, idx) => (
                    <div key={item.chunk_id || idx} className="evidence-card">
                      <div className="evidence-meta">
                        <span className="evidence-doc-name">{item.contractTitle}</span>
                        <span className="citation-inline">
                          {item.citation || `Page ${item.page_number}, ${item.section}`}
                        </span>
                        <span className="mono-caption">
                          {Math.round((item.score || 0) * 100)}% match
                        </span>
                      </div>
                      <p className="evidence-text">{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="legal-disclaimer">AI-assisted search across your uploaded contracts — not legal advice.</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
