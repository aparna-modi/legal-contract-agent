import shutil
import tempfile
import pytest

from services.retrieval_service import LegalReranker, RetrievalService
from services.vector_store import ChromaVectorStore


@pytest.fixture
def test_retrieval_service():
    """Create a clean isolated RetrievalService instance."""
    temp_dir = tempfile.mkdtemp()
    store = ChromaVectorStore(persist_directory=temp_dir, collection_name="test_retrieval")
    service = RetrievalService(store=store)
    yield service
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_legal_reranker():
    """Verify LegalReranker weights legal concepts, section headings, and query keywords."""
    reranker = LegalReranker()
    candidates = [
        {
            "chunk_id": "c1",
            "text": "The party shall pay invoices within 15 calendar days from billing date.",
            "section": "Payment Terms",
            "clause_type": "payment",
            "page_number": 1,
            "similarity_score": 0.50,
        },
        {
            "chunk_id": "c2",
            "text": "In the event of a material breach, either party may terminate immediately.",
            "section": "Termination and Cancellation",
            "clause_type": "termination",
            "page_number": 3,
            "similarity_score": 0.45,
        },
    ]

    # Query about termination
    reranked = reranker.rerank("material breach termination rights", candidates, top_k=2)
    assert len(reranked) == 2
    # c2 should rank first because of termination concept + section heading match + breach match
    assert reranked[0]["chunk_id"] == "c2"
    assert reranked[0]["score"] > reranked[1]["score"]
    assert "Termination and Cancellation" in reranked[0]["citation"]


def test_retrieval_grounded_answer(test_retrieval_service):
    """Verify grounded retrieval returns citations, confidence, and answer."""
    chunks = [
        {
            "chunk_id": "c1",
            "text": "In the event of an uncured breach, either party may terminate this agreement upon 30 days prior written notice.",
            "section": "Termination for Cause",
            "clause_type": "termination",
            "page_number": 5,
        },
        {
            "chunk_id": "c2",
            "text": "Contractor shall maintain commercial general liability insurance of at least $1,000,000 per occurrence.",
            "section": "Insurance Requirements",
            "clause_type": "insurance",
            "page_number": 7,
        },
    ]

    test_retrieval_service.store.upsert_chunks("user_100", "doc_contract1", chunks)

    # Ask about termination
    res = test_retrieval_service.retrieve(
        query="What is the notice period required to terminate for breach?",
        user_id="user_100",
        document_id="doc_contract1",
        top_k=2,
        min_score=0.25,
    )

    assert res["insufficient_information"] is False
    assert len(res["results"]) > 0
    top_result = res["results"][0]
    assert top_result["chunk_id"] == "c1"
    assert "Termination for Cause" in top_result["citation"]
    assert "Page 5" in top_result["citation"]
    assert len(res["citations"]) > 0
    assert "30 days" in res["answer"] or "terminate" in res["answer"].lower()


def test_insufficient_information_hallucination_defense(test_retrieval_service):
    """
    CRITICAL QUALITY REQUIREMENT (Section 3.4 of Design Template):
    Verify that when a question asks for nonexistent legal terms (e.g. space exploration travel policies),
    the system rejects weak evidence and returns an explicit 'insufficient information' answer.
    """
    chunks = [
        {
            "chunk_id": "c1",
            "text": "This agreement is governed by the laws of the State of Delaware.",
            "section": "Governing Law",
            "clause_type": "governing_law",
            "page_number": 1,
        }
    ]

    test_retrieval_service.store.upsert_chunks("user_100", "doc_legal", chunks)

    # Query asking completely unrelated topic
    res = test_retrieval_service.retrieve(
        query="What are the cryptocurrency severance bonuses for interstellar spacecraft pilots?",
        user_id="user_100",
        document_id="doc_legal",
        top_k=2,
        min_score=0.40,
    )

    assert res["insufficient_information"] is True
    assert "Insufficient information" in res["message"]
    assert "insufficient evidence" in res["answer"].lower()


def test_gemini_grounded_answer_synthesis(test_retrieval_service, monkeypatch):
    """Verify Gemini API generateContent is invoked when GEMINI_API_KEY is configured."""
    gemini_answer_text = "According to Section: Termination, either party may terminate with 30 days notice."

    class MockGeminiResponse:
        status_code = 200
        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": gemini_answer_text}],
                            "role": "model",
                        }
                    }
                ]
            }

    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key-xyz")
    monkeypatch.setattr("httpx.Client.post", lambda *args, **kwargs: MockGeminiResponse())

    passages = [
        {
            "chunk_id": "c1",
            "text": "Either party may terminate upon 30 days notice.",
            "citation": "Page 2, Section: 'Termination' [termination]",
            "score": 0.85,
        }
    ]

    answer = test_retrieval_service._synthesize_grounded_answer("How can we terminate?", passages)
    assert answer == gemini_answer_text

