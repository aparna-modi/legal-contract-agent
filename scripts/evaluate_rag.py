import os
import sys
import uuid
from typing import Any, Dict, List

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AI_SERVICE_DIR = os.path.join(REPO_ROOT, "ai-service")
if AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, AI_SERVICE_DIR)

from services.retrieval_service import retrieval_service  # noqa: E402
from services.vector_store import vector_store  # noqa: E402


SAMPLE_CHUNKS: List[Dict[str, Any]] = [
    {
        "chunk_id": 0,
        "text": (
            "Section 4. Limitation of Liability. Except for liability arising from gross "
            "negligence, willful misconduct, or indemnification obligations, neither party's "
            "aggregate liability shall exceed the total fees paid in the preceding twelve months."
        ),
        "page_number": 2,
        "section_heading": "4. Limitation of Liability",
        "clause_type": "Limitation of Liability",
        "risk_level": "medium",
    },
    {
        "chunk_id": 1,
        "text": (
            "Section 7. Termination for Cause. Either party may terminate this Agreement upon "
            "thirty (30) days written notice if the other party materially breaches any term "
            "and fails to cure within such thirty-day cure period."
        ),
        "page_number": 4,
        "section_heading": "7. Termination for Cause",
        "clause_type": "Termination",
        "risk_level": "low",
    },
    {
        "chunk_id": 2,
        "text": (
            "Section 9. Confidentiality. Receiving Party shall protect all Confidential Information "
            "using at least reasonable care and shall not disclose it for five (5) years after "
            "expiration or termination of this Agreement."
        ),
        "page_number": 5,
        "section_heading": "9. Confidentiality",
        "clause_type": "Confidentiality / NDA",
        "risk_level": "low",
    },
    {
        "chunk_id": 3,
        "text": (
            "Section 12. Governing Law. This Agreement shall be governed by and construed in "
            "accordance with the laws of India, with exclusive jurisdiction in the courts of "
            "Bengaluru, Karnataka."
        ),
        "page_number": 7,
        "section_heading": "12. Governing Law",
        "clause_type": "Governing Law & Jurisdiction",
        "risk_level": "low",
    },
]

EVAL_QUERIES: List[Dict[str, Any]] = [
    {
        "query": "What is the liability cap and twelve-month fee limit?",
        "expected_headings": ["4. Limitation of Liability"],
    },
    {
        "query": "How many days written notice and cure period apply to termination?",
        "expected_headings": ["7. Termination for Cause"],
    },
    {
        "query": "How long must confidential information be protected after termination?",
        "expected_headings": ["9. Confidentiality"],
    },
    {
        "query": "Which state courts and laws govern this agreement?",
        "expected_headings": ["12. Governing Law"],
    },
]


def evaluate_retrieval(user_id: str, doc_id: str, top_k: int = 3) -> Dict[str, float]:
    hits = 0
    total_precision = 0.0
    total_recall = 0.0

    for item in EVAL_QUERIES:
        expected = set(item["expected_headings"])
        response = retrieval_service.retrieve(
            query=item["query"],
            user_id=user_id,
            document_id=doc_id,
            top_k=top_k,
            min_score=0.0,
            use_reranker=True,
        )
        results = response.get("results", [])
        retrieved_headings = [r.get("section_heading") or r.get("clause_type") for r in results]
        matched_expected = expected.intersection(retrieved_headings)

        if matched_expected:
            hits += 1

        precision = len(matched_expected) / max(1, len(retrieved_headings))
        recall = len(matched_expected) / max(1, len(expected))
        total_precision += precision
        total_recall += recall

    n = max(1, len(EVAL_QUERIES))
    return {
        "queries": n,
        "hit_rate_at_k": round(hits / n, 3),
        "precision_at_k": round(total_precision / n, 3),
        "recall_at_k": round(total_recall / n, 3),
    }


def verify_tenant_isolation(user_a: str, user_b: str, doc_a: str) -> Dict[str, bool]:
    cross_user_res = retrieval_service.retrieve(
        query="What is the liability cap?",
        user_id=user_b,
        document_id=doc_a,
        top_k=5,
        min_score=0.0,
        use_reranker=False,
    )
    leaked_results = cross_user_res.get("results", [])
    isolation_passed = len(leaked_results) == 0

    # Ensure user_b attempting to delete doc_a does not remove user_a's chunks
    vector_store.delete_by_document(user_b, doc_a)
    user_a_check = retrieval_service.retrieve(
        query="What is the liability cap?",
        user_id=user_a,
        document_id=doc_a,
        top_k=3,
        min_score=0.0,
        use_reranker=False,
    )
    surviving_chunks = len(user_a_check.get("results", [])) > 0

    return {
        "cross_user_query_blocked": isolation_passed,
        "cross_user_delete_protected": surviving_chunks,
    }


def main() -> None:
    run_tag = uuid.uuid4().hex[:8]
    user_a = f"eval_user_a_{run_tag}"
    user_b = f"eval_user_b_{run_tag}"
    doc_a = f"eval_doc_a_{run_tag}"

    try:
        vector_store.upsert_chunks(user_id=user_a, document_id=doc_a, chunks=SAMPLE_CHUNKS)
        metrics = evaluate_retrieval(user_id=user_a, doc_id=doc_a, top_k=3)
        security = verify_tenant_isolation(user_a=user_a, user_b=user_b, doc_a=doc_a)

        print("RAG Evaluation Metrics (top_k=3):", metrics)
        print("Multi-Tenant Security Check:", security)
    finally:
        vector_store.delete_by_document(user_a, doc_a)


if __name__ == "__main__":
    main()
