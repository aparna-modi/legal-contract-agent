import os
import re
from typing import Any, Dict, List, Optional
import httpx

from services.embedding_service import embedding_service, LEGAL_KEYWORDS
from services.vector_store import vector_store, BaseVectorStore

# Common stopwords to exclude from keyword extraction
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "did", "do", "does", "doing", "don't", "down",
    "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "her",
    "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is",
    "isn't", "it", "its", "itself", "me", "more", "most", "must", "my", "myself", "no", "nor",
    "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
    "out", "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the",
    "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "were", "what",
    "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your",
}


class LegalReranker:
    """
    Domain-Specific Legal Cross-Clause Reranker.
    Re-evaluates candidate passages returned by vector similarity search using:
    1. Dense semantic cosine similarity
    2. Legal taxonomy & concept weighting
    3. Exact phrase & token overlap
    4. Section heading & clause metadata alignment
    """

    def __init__(self):
        pass

    @staticmethod
    def _extract_query_keywords(query: str) -> List[str]:
        tokens = re.findall(r"\b[a-z0-9_-]{3,}\b", query.lower())
        return [t for t in tokens if t not in STOPWORDS]

    def rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        if not candidates or not query:
            return candidates[:top_k]

        q_lower = query.lower()
        q_keywords = self._extract_query_keywords(query)
        reranked: List[Dict[str, Any]] = []

        for candidate in candidates:
            text = candidate.get("text", "")
            text_lower = text.lower()
            section = str(candidate.get("section", "")).lower()
            dense_sim = candidate.get("similarity_score", 0.0)

            # 1. Lexical and keyword overlap
            matched_keywords = [kw for kw in q_keywords if kw in text_lower or kw in section]
            lexical_ratio = (
                len(matched_keywords) / len(q_keywords) if q_keywords else 0.0
            )

            # 2. Legal concept alignment
            legal_bonus = 0.0
            for term, weight in LEGAL_KEYWORDS.items():
                if term in q_lower and (term in text_lower or term in section):
                    legal_bonus = max(legal_bonus, min(0.20, (weight - 1.0) * 0.08))

            # 3. Section heading bonus
            heading_bonus = 0.0
            for kw in q_keywords:
                if kw in section:
                    heading_bonus += 0.08
            heading_bonus = min(0.20, heading_bonus)

            # 4. Exact phrase matching bonus
            phrase_bonus = 0.12 if len(q_keywords) >= 2 and any(
                q_keywords[i] + " " + q_keywords[i+1] in text_lower
                for i in range(len(q_keywords) - 1)
            ) else 0.0

            # Composite rerank score
            combined_score = (
                0.50 * dense_sim
                + 0.25 * lexical_ratio
                + 0.10 * legal_bonus
                + 0.10 * heading_bonus
                + 0.05 * phrase_bonus
            )
            final_score = max(0.0, min(1.0, round(combined_score, 4)))

            # Formulate citation string adhering to legal review requirements
            page_num = candidate.get("page_number", 1)
            sec_name = candidate.get("section", "General")
            clause_type = candidate.get("clause_type", "clause")
            citation = f"Page {page_num}, Section: '{sec_name}' [{clause_type}]"

            candidate_copy = dict(candidate)
            candidate_copy["dense_score"] = dense_sim
            candidate_copy["rerank_score"] = round(
                (0.5 * lexical_ratio + 0.3 * legal_bonus + 0.2 * heading_bonus), 4
            )
            candidate_copy["score"] = final_score
            candidate_copy["citation"] = citation
            candidate_copy["matched_terms"] = matched_keywords
            reranked.append(candidate_copy)

        # Sort descending by final combined score
        reranked.sort(key=lambda x: x["score"], reverse=True)
        return reranked[:top_k]


class RetrievalService:
    """
    End-to-End Grounded Retrieval Pipeline.
    Orchestrates:
    1. Query embedding generation
    2. Multi-tenant vector similarity search
    3. Legal cross-clause reranking
    4. Hallucination prevention via relevance thresholding
    5. Evidence citation formatting
    6. Grounded response synthesis
    """

    def __init__(self, store: Optional[BaseVectorStore] = None):
        self.store = store or vector_store
        self.reranker = LegalReranker()
        self.openai_key = os.environ.get("OPENAI_API_KEY")
        self.gemini_key = os.environ.get("GEMINI_API_KEY")

    def retrieve(
        self,
        query: str,
        user_id: str,
        document_id: Optional[str] = None,
        top_k: int = 5,
        min_score: float = 0.25,
        use_reranker: bool = True,
    ) -> Dict[str, Any]:
        """
        Execute grounded retrieval pipeline for a query.
        Guarantees tenant isolation by filtering on user_id.
        """
        if not query or not query.strip():
            return {
                "query": query,
                "total_candidates": 0,
                "results": [],
                "insufficient_information": True,
                "message": "Query cannot be empty.",
            }

        # 1. Embed query
        query_vector = embedding_service.embed_text(query)

        # 2. Vector similarity search (over-fetch 3x for reranker)
        fetch_limit = top_k * 3 if use_reranker else top_k
        raw_candidates = self.store.search(
            user_id=user_id,
            query_vector=query_vector,
            document_id=document_id,
            top_k=fetch_limit,
        )

        if not raw_candidates:
            return {
                "query": query,
                "total_candidates": 0,
                "results": [],
                "insufficient_information": True,
                "message": "No indexed clauses found for this user or document. Please parse/index the contract first.",
            }

        # 3. Apply Reranker
        if use_reranker:
            final_passages = self.reranker.rerank(query, raw_candidates, top_k=top_k)
        else:
            final_passages = raw_candidates[:top_k]
            for p in final_passages:
                p["score"] = p.get("similarity_score", 0.0)
                p["citation"] = f"Page {p.get('page_number', 1)}, Section: '{p.get('section', 'General')}'"

        # 4. Check Hallucination Defense Threshold (min_score)
        max_score = final_passages[0]["score"] if final_passages else 0.0
        insufficient = max_score < min_score

        # Filter passages meeting min_score or keep top 1 if close
        verified_passages = [p for p in final_passages if p["score"] >= min_score]

        if insufficient or not verified_passages:
            return {
                "query": query,
                "total_candidates": len(raw_candidates),
                "results": final_passages[:2],  # Provide weak candidates for review
                "insufficient_information": True,
                "message": (
                    f"Insufficient information in the contract to reliably answer: '{query}'. "
                    f"(Top relevance score {max_score:.2f} is below the verification threshold of {min_score:.2f})"
                ),
                "answer": (
                    "Based strictly on the provided contract text, there is insufficient evidence or no specific "
                    f"clause addressing '{query}'. The system avoided hallucination by adhering to the verification threshold."
                ),
            }

        # 5. Synthesize grounded answer
        answer = self._synthesize_grounded_answer(query, verified_passages)

        return {
            "query": query,
            "total_candidates": len(raw_candidates),
            "results": verified_passages,
            "insufficient_information": False,
            "confidence": "HIGH" if max_score >= 0.60 else ("MEDIUM" if max_score >= 0.40 else "LOW"),
            "answer": answer,
            "citations": [p["citation"] for p in verified_passages],
        }

    def _synthesize_grounded_answer(
        self, query: str, passages: List[Dict[str, Any]]
    ) -> str:
        """
        Synthesize a grounded answer strictly based on retrieved contract passages.
        Uses LLM if API key is configured, or high-fidelity extractive synthesis offline.
        """
        top_passage = passages[0]
        citations_summary = ", ".join({p["citation"] for p in passages[:3]})

        # If external LLM key is available, attempt remote call with strict hallucination defense prompt
        if self.gemini_key or self.openai_key:
            try:
                # Built with strict zero-shot grounding prompt
                context_block = "\n\n".join(
                    f"[Source: {p['citation']}]\n{p['text']}" for p in passages[:3]
                )
                prompt = (
                    "You are a strict legal assistant. Answer the user question ONLY based on the cited contract excerpts below. "
                    "If the answer is not clearly stated, say 'The contract does not provide sufficient details.' "
                    "Never make legal assumptions or hallucinate terms not in the text.\n\n"
                    f"Contract Excerpts:\n{context_block}\n\n"
                    f"Question: {query}\n\n"
                    "Grounded Answer (include page/section citations):"
                )

                if self.openai_key:
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            "https://api.openai.com/v1/chat/completions",
                            headers={"Authorization": f"Bearer {self.openai_key}"},
                            json={
                                "model": "gpt-4o-mini",
                                "messages": [{"role": "user", "content": prompt}],
                                "temperature": 0.0,
                            },
                        )
                        if resp.status_code == 200:
                            return resp.json()["choices"][0]["message"]["content"]
            except Exception:
                pass  # Fallback to local synthesis

        # Deterministic extractive synthesis
        return (
            f"According to the contract ({top_passage['citation']}): "
            f"\"{top_passage['text']}\" "
            f"(Evidence confirmed from {citations_summary})"
        )


# Global singleton instance
retrieval_service = RetrievalService()
