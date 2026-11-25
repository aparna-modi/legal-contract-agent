import io
from pathlib import Path
from fastapi.testclient import TestClient

from main import app
from services.vector_store import vector_store

client = TestClient(app)


def test_security_headers_and_request_id_propagation():
    res = client.get("/health/live", headers={"X-Request-Id": "req-trace-123"})
    assert res.status_code == 200
    assert res.headers.get("X-Request-Id") == "req-trace-123"
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"


def test_readiness_probe_returns_ready():
    res = client.get("/health/ready")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert "embedding_provider" in data


def test_internal_service_key_enforcement(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "super-secret-internal-key-999")

    # Health probes remain accessible for load balancers.
    assert client.get("/health/ready").status_code == 200

    # Protected AI route rejects missing or wrong key.
    res_missing = client.get("/api/v1/vector/stats")
    assert res_missing.status_code == 401

    res_wrong = client.get(
        "/api/v1/vector/stats",
        headers={"X-Internal-Service-Key": "wrong-key"},
    )
    assert res_wrong.status_code == 401

    res_valid = client.get(
        "/api/v1/vector/stats",
        headers={"X-Internal-Service-Key": "super-secret-internal-key-999"},
    )
    assert res_valid.status_code == 200


def test_extract_path_blocks_path_outside_allowed_dirs():
    # Attempt to read a real file in the repo outside upload directories.
    repo_readme = str(Path(__file__).resolve().parents[2] / "README.md")
    res = client.post("/api/v1/extract-path", json={"file_path": repo_readme})
    assert res.status_code in (400, 403)

    # Attempt to read a real .txt file outside upload directories (requirements.txt).
    req_txt = str(Path(__file__).resolve().parents[1] / "requirements.txt")
    res_txt = client.post("/api/v1/extract-path", json={"file_path": req_txt})
    assert res_txt.status_code == 403


def test_magic_byte_validation_rejects_disguised_files():
    fake_pdf = io.BytesIO(b"<script>alert('xss')</script> not a real pdf")
    res = client.post(
        "/api/v1/extract",
        files={"file": ("evil.pdf", fake_pdf, "application/pdf")},
    )
    assert res.status_code == 400
    assert "PDF" in res.json()["detail"]

    binary_txt = io.BytesIO(b"hello\x00world\x00binary")
    res_txt = client.post(
        "/api/v1/extract",
        files={"file": ("payload.txt", binary_txt, "text/plain")},
    )
    assert res_txt.status_code == 400


def test_stateless_multipart_extract_with_vector_indexing(sample_txt_content):
    user_id = "stateless_test_user"
    doc_id = "stateless_doc_1"
    vector_store.delete_by_user(user_id)
    try:
        res = client.post(
            "/api/v1/extract",
            files={"file": ("employment.txt", io.BytesIO(sample_txt_content.encode("utf-8")), "text/plain")},
            data={
                "title": "Employment Agreement",
                "embed": "true",
                "user_id": user_id,
                "document_id": doc_id,
                "index_vector": "true",
            },
        )
        assert res.status_code == 200
        assert vector_store.count(user_id=user_id) > 0
    finally:
        vector_store.delete_by_user(user_id)
