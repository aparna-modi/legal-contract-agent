import pytest
from fastapi.testclient import TestClient

from main import app
from services.vector_store import vector_store

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_test_vectors():
    """Ensure clean vector state for test user before and after tests."""
    test_user = "test_api_user"
    vector_store.delete_by_user(test_user)
    yield
    vector_store.delete_by_user(test_user)


def test_api_vector_lifecycle_and_retrieve():
    """Test full API vector indexing, retrieval, and deletion lifecycle."""
    user_id = "test_api_user"
    doc_id = "doc_test_1"

    # 1. Index chunks
    index_payload = {
        "user_id": user_id,
        "document_id": doc_id,
        "chunks": [
            {
                "chunk_id": "api_c1",
                "text": "The maximum aggregate liability under this agreement is limited to fifty thousand dollars ($50,000).",
                "section": "Limitation of Liability",
                "clause_type": "liability",
                "page_number": 3,
            },
            {
                "chunk_id": "api_c2",
                "text": "Company owns all intellectual property, work product, and patentable inventions created under this scope.",
                "section": "Intellectual Property Ownership",
                "clause_type": "ip",
                "page_number": 6,
            },
        ],
    }

    res_index = client.post("/api/v1/vector/index", json=index_payload)
    assert res_index.status_code == 200
    data_index = res_index.json()
    assert data_index["status"] == "success"
    assert data_index["indexed_count"] == 2

    # 2. Get vector stats
    res_stats = client.get(f"/api/v1/vector/stats?user_id={user_id}")
    assert res_stats.status_code == 200
    data_stats = res_stats.json()
    assert data_stats["total_vectors"] >= 2
    assert data_stats["user_vectors"] == 2

    # 3. Retrieve relevant chunk
    retrieve_payload = {
        "query": "What is the liability dollar limit or liability cap?",
        "user_id": user_id,
        "document_id": doc_id,
        "top_k": 3,
        "min_score": 0.20,
    }
    res_retrieve = client.post("/api/v1/retrieve", json=retrieve_payload)
    assert res_retrieve.status_code == 200
    data_ret = res_retrieve.json()
    assert data_ret["insufficient_information"] is False
    assert len(data_ret["results"]) > 0
    top_p = data_ret["results"][0]
    assert top_p["chunk_id"] == "api_c1"
    assert "$50,000" in top_p["text"]
    assert "Limitation of Liability" in top_p["citation"]

    # 4. Delete document vectors
    delete_payload = {
        "user_id": user_id,
        "document_id": doc_id,
    }
    res_del = client.post("/api/v1/vector/delete", json=delete_payload)
    assert res_del.status_code == 200
    assert res_del.json()["deleted_count"] == 2

    # 5. Verify stats updated
    res_stats_after = client.get(f"/api/v1/vector/stats?user_id={user_id}")
    assert res_stats_after.json()["user_vectors"] == 0
