import shutil
import tempfile

import pytest

from services.retrieval_service import (
    GroundedAnswerSchema,
    LegalReranker,
    RetrievalService,
)
from services.vector_store import ChromaVectorStore


@pytest.fixture
def test_retrieval_service():
    temp_dir = tempfile.mkdtemp()
    store = ChromaVectorStore(persist_directory=temp_dir, collection_name="test_retrieval")
    service = RetrievalService(store=store)
    yield service
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_legal_reranker():
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

    reranked = reranker.rerank(
        "material breach termination rights", candidates, top_k=2, is_neural=False
    )
    assert len(reranked) == 2
    assert reranked[0]["chunk_id"] == "c2"
    assert reranked[0]["score"] > reranked[1]["score"]
    assert "Termination and Cancellation" in reranked[0]["citation"]


def test_retrieval_grounded_answer(test_retrieval_service):
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

    res = test_retrieval_service.retrieve(
        query="What are the cryptocurrency severance bonuses for interstellar spacecraft pilots?",
        user_id="user_100",
        document_id="doc_legal",
        top_k=2,
        min_score=0.25,
    )

    assert res["insufficient_information"] is True
    assert "Insufficient information" in res["message"]


def test_gemini_grounded_answer_synthesis_mocked(test_retrieval_service, monkeypatch):
    expected_answer = "According to Page 2, Section 'Termination', either party may terminate with 30 days notice."

    monkeypatch.setattr(
        "services.retrieval_service.llm_client.generate_structured",
        lambda **kwargs: GroundedAnswerSchema(is_supported=True, answer=expected_answer),
    )

    passages = [
        {
            "chunk_id": "c1",
            "text": "Either party may terminate upon 30 days notice.",
            "citation": "Page 2, Section: 'Termination' [termination]",
            "score": 0.85,
        }
    ]

    synthesis = test_retrieval_service._synthesize_grounded_answer("How can we terminate?", passages)
    assert synthesis["is_supported"] is True
    assert synthesis["answer"] == expected_answer


def test_gemini_unsupported_abstention_override(test_retrieval_service, monkeypatch):
    chunks = [
        {
            "chunk_id": "c1",
            "text": "Either party may terminate this agreement upon 30 days written notice.",
            "section": "Termination",
            "clause_type": "termination",
            "page_number": 2,
        }
    ]
    test_retrieval_service.store.upsert_chunks("user_101", "doc_refuse", chunks)

    monkeypatch.setattr(
        "services.retrieval_service.llm_client.generate_structured",
        lambda **kwargs: GroundedAnswerSchema(
            is_supported=False,
            answer="The contract does not specify any severance pay amount upon termination.",
        ),
    )

    res = test_retrieval_service.retrieve(
        query="What is the exact severance payout upon termination?",
        user_id="user_101",
        document_id="doc_refuse",
        top_k=2,
        min_score=0.10,
    )
    assert res["insufficient_information"] is True
    assert "does not specify" in res["answer"].lower()
