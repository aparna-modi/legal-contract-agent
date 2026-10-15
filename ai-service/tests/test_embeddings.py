import pytest
from fastapi.testclient import TestClient

from extractors.base import DocumentChunk
from main import app
from services.embedding_service import EmbeddingService, embedding_service


@pytest.fixture
def client():
    return TestClient(app)


class TestEmbeddingService:
    def test_single_text_embedding_properties(self):
        service = EmbeddingService(dimension=384)
        text = "Service Provider shall indemnify, defend and hold harmless the Client against all claims."
        vec = service.embed_text(text)

        assert isinstance(vec, list)
        assert len(vec) == 384
        # Verify L2 unit normalization
        norm = sum(x * x for x in vec) ** 0.5
        assert pytest.approx(norm, abs=1e-3) == 1.0

    def test_empty_text_embedding(self):
        service = EmbeddingService(dimension=384)
        vec = service.embed_text("")
        assert len(vec) == 384
        assert all(x == 0.0 for x in vec)

    def test_batch_embeddings(self):
        service = EmbeddingService(dimension=384)
        texts = [
            "1. Termination for convenience upon 30 days notice.",
            "2. Governing law shall be the State of California.",
            "3. Mutual non-disclosure of confidential trade secrets.",
        ]
        vectors = service.embed_batch(texts)
        assert len(vectors) == 3
        for v in vectors:
            assert len(v) == 384
            norm = sum(x * x for x in v) ** 0.5
            assert pytest.approx(norm, abs=1e-3) == 1.0

    def test_chunk_enrichment(self):
        chunks = [
            DocumentChunk(
                chunk_id=1,
                text="The parties agree to keep all proprietary information confidential.",
                start_char=0,
                end_char=68,
                token_count=12,
                section_heading="Confidentiality",
            ),
            DocumentChunk(
                chunk_id=2,
                text="Either party may terminate this agreement with 15 days notice.",
                start_char=69,
                end_char=131,
                token_count=11,
                section_heading="Termination",
            ),
        ]
        enriched = embedding_service.embed_chunks(chunks)
        assert len(enriched) == 2
        for chunk in enriched:
            assert chunk.embedding is not None
            assert len(chunk.embedding) == 384
            assert chunk.embedding_dim == 384

    def test_cosine_similarity(self):
        service = EmbeddingService(dimension=384)
        text1 = "Party A shall indemnify and hold harmless Party B against third-party claims."
        text2 = "Service Provider agrees to indemnify, defend, and hold harmless the Customer."
        text3 = "The pizza delivery arrived at noon with extra cheese and toppings."

        v1 = service.embed_text(text1)
        v2 = service.embed_text(text2)
        v3 = service.embed_text(text3)

        sim_identical = service.cosine_similarity(v1, v1)
        assert pytest.approx(sim_identical, abs=1e-2) == 1.0

        sim_similar_legal = service.cosine_similarity(v1, v2)
        sim_unrelated = service.cosine_similarity(v1, v3)

        assert sim_similar_legal > sim_unrelated
        assert sim_similar_legal > 0.4


class TestEmbeddingEndpoints:
    def test_embed_endpoint(self, client):
        payload = {
            "texts": [
                "Payment shall be made within 30 days of invoice receipt.",
                "Intellectual property rights remain exclusively with Developer.",
            ]
        }
        res = client.post("/api/v1/embed", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["count"] == 2
        assert data["dimension"] == 384
        assert len(data["embeddings"]) == 2
        assert len(data["embeddings"][0]) == 384

    def test_similarity_endpoint(self, client):
        payload = {
            "text_a": "Governing law of this contract is the laws of New York.",
            "text_b": "This agreement is governed by and construed under New York law.",
        }
        res = client.post("/api/v1/similarity", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert "similarity" in data
        assert 0.0 <= data["similarity"] <= 1.0
        assert data["similarity"] > 0.3

    def test_extract_path_with_embeddings(self, client, tmp_path, sample_txt_content):
        file_path = tmp_path / "test_contract.txt"
        file_path.write_text(sample_txt_content, encoding="utf-8")

        payload = {
            "file_path": str(file_path),
            "title": "test_contract.txt",
            "embed": True,
        }
        res = client.post("/api/v1/extract-path", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["has_embeddings"] is True
        assert data["embedding_model"] is not None
        assert len(data["chunks"]) > 0
        for chunk in data["chunks"]:
            assert chunk["embedding"] is not None
            assert len(chunk["embedding"]) == 384
            assert chunk["embedding_dim"] == 384

    def test_gemini_embedding_service_mocked(self, monkeypatch):
        mock_vector = [0.05] * 384

        class MockResponse:
            status_code = 200
            def json(self):
                return {"embedding": {"values": mock_vector}}

        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key-12345")
        service = EmbeddingService(dimension=384)
        assert "gemini" in service.get_provider_name()

        monkeypatch.setattr("httpx.Client.post", lambda *args, **kwargs: MockResponse())
        res = service.embed_text("Test contract clause")
        assert len(res) == 384
        assert res == mock_vector

    def test_gemini_batch_embedding_mocked(self, monkeypatch):
        mock_vectors = [[0.02] * 384, [0.03] * 384]

        class MockBatchResponse:
            status_code = 200
            def json(self):
                return {"embeddings": [{"values": mock_vectors[0]}, {"values": mock_vectors[1]}]}

        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key-12345")
        service = EmbeddingService(dimension=384)

        monkeypatch.setattr("httpx.Client.post", lambda *args, **kwargs: MockBatchResponse())
        results = service.embed_batch(["Clause 1", "Clause 2"])
        assert len(results) == 2
        assert results == mock_vectors

    def test_gemini_embedding_fallback_on_error(self, monkeypatch):
        class MockErrorResponse:
            status_code = 500
            def json(self):
                return {"error": "API quota exceeded"}

        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key-12345")
        service = EmbeddingService(dimension=384)

        monkeypatch.setattr("httpx.Client.post", lambda *args, **kwargs: MockErrorResponse())
        # Should gracefully fall back to local 384-d vectorizer without throwing
        fallback_res = service.embed_text("Fallback clause")
        assert len(fallback_res) == 384
        assert any(x != 0.0 for x in fallback_res)

