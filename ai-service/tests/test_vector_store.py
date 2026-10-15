import shutil
import tempfile
import pytest

from services.vector_store import ChromaVectorStore


@pytest.fixture
def temp_vector_store():
    """Create an isolated temporary ChromaDB vector store for testing."""
    temp_dir = tempfile.mkdtemp()
    store = ChromaVectorStore(persist_directory=temp_dir, collection_name="test_contracts")
    yield store
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_vector_store_upsert_and_search(temp_vector_store):
    """Verify upsert and semantic similarity search with cosine similarity."""
    sample_chunks = [
        {
            "chunk_id": "c1",
            "text": "Either party may terminate this agreement with 30 days written notice.",
            "page_number": 2,
            "section": "Termination",
            "clause_type": "termination",
        },
        {
            "chunk_id": "c2",
            "text": "All confidential information shall remain strictly protected for five years.",
            "page_number": 4,
            "section": "Confidentiality",
            "clause_type": "confidentiality",
        },
    ]

    count = temp_vector_store.upsert_chunks(
        user_id="user_123", document_id="doc_abc", chunks=sample_chunks
    )
    assert count == 2
    assert temp_vector_store.count() == 2
    assert temp_vector_store.count(user_id="user_123") == 2

    # Query using termination concept
    from services.embedding_service import embedding_service
    q_vec = embedding_service.embed_text("how to terminate this agreement notice period")

    results = temp_vector_store.search(
        user_id="user_123", query_vector=q_vec, document_id="doc_abc", top_k=2
    )
    assert len(results) == 2
    top = results[0]
    assert top["chunk_id"] == "c1"
    assert "terminate" in top["text"].lower()
    assert top["page_number"] == 2
    assert top["section"] == "Termination"
    assert top["similarity_score"] > 0.0


def test_multi_tenant_isolation(temp_vector_store):
    """
    SECURITY CRITICAL TEST:
    Verify that User A's uploaded contract vectors are never retrievable by User B.
    """
    user_a_chunks = [
        {
            "chunk_id": "secret_c1",
            "text": "Top secret merger between Acme Corp and Omega LLC for $500M.",
            "page_number": 1,
            "section": "Confidential Terms",
        }
    ]
    user_b_chunks = [
        {
            "chunk_id": "b_c1",
            "text": "Standard employment handbook for Beta Corp employees.",
            "page_number": 1,
            "section": "Policies",
        }
    ]

    temp_vector_store.upsert_chunks("user_alice", "doc_merger", user_a_chunks)
    temp_vector_store.upsert_chunks("user_bob", "doc_handbook", user_b_chunks)

    from services.embedding_service import embedding_service
    q_vec = embedding_service.embed_text("Acme Corp merger confidential details")

    # Bob searches for Alice's secret merger
    bob_results = temp_vector_store.search(
        user_id="user_bob", query_vector=q_vec, top_k=5
    )
    # Bob MUST NOT receive any of Alice's chunks
    for r in bob_results:
        assert r["user_id"] == "user_bob"
        assert "merger" not in r["text"].lower()

    # Alice searches and retrieves her own data
    alice_results = temp_vector_store.search(
        user_id="user_alice", query_vector=q_vec, top_k=5
    )
    assert len(alice_results) == 1
    assert alice_results[0]["chunk_id"] == "secret_c1"
    assert alice_results[0]["user_id"] == "user_alice"


def test_document_scoping_and_deletion(temp_vector_store):
    """Verify document-scoped filtering and cascade deletion."""
    chunks_doc1 = [
        {"chunk_id": "d1_c1", "text": "Contract One liability clause cap at $10,000.", "section": "Liability"}
    ]
    chunks_doc2 = [
        {"chunk_id": "d2_c1", "text": "Contract Two liability clause unlimited liability.", "section": "Liability"}
    ]

    temp_vector_store.upsert_chunks("user_1", "doc_1", chunks_doc1)
    temp_vector_store.upsert_chunks("user_1", "doc_2", chunks_doc2)

    from services.embedding_service import embedding_service
    q_vec = embedding_service.embed_text("liability cap")

    # Search scoped to doc_1
    scoped_results = temp_vector_store.search(
        user_id="user_1", query_vector=q_vec, document_id="doc_1", top_k=5
    )
    assert len(scoped_results) == 1
    assert scoped_results[0]["document_id"] == "doc_1"

    # Delete doc_1
    deleted_count = temp_vector_store.delete_by_document("user_1", "doc_1")
    assert deleted_count == 1
    assert temp_vector_store.count("user_1") == 1

    # Now searching doc_1 returns nothing
    scoped_after_delete = temp_vector_store.search(
        user_id="user_1", query_vector=q_vec, document_id="doc_1", top_k=5
    )
    assert len(scoped_after_delete) == 0


def test_vector_store_telemetry(temp_vector_store):
    """Verify vector store stats and telemetry report."""
    stats = temp_vector_store.stats()
    assert "provider" in stats
    assert "collection_name" in stats
    assert stats["total_vectors"] == 0
    assert stats["status"] == "ready"
