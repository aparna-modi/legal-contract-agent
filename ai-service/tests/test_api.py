import io
import os
import tempfile
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "endpoints" in data
    assert data["endpoints"]["health"] == "/health"


def test_health_check_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "healthy"
    assert "system" in data
    assert "memory" in data["system"]
    assert "cpu" in data["system"]
    assert "gpu" in data["system"]
    assert "total_mb" in data["system"]["memory"]
    assert "percent_used" in data["system"]["memory"]
    assert "percent_used" in data["system"]["cpu"]
    assert "available" in data["system"]["gpu"]

    # Verify extractor readiness
    assert data["extractors_ready"]["pdf"] is True
    assert data["extractors_ready"]["docx"] is True
    assert data["extractors_ready"]["txt"] is True


def test_extract_txt_file_upload(sample_txt_content):
    file_bytes = sample_txt_content.encode("utf-8")
    files = {"file": ("contract.txt", io.BytesIO(file_bytes), "text/plain")}

    response = client.post("/api/v1/extract", files=files)
    assert response.status_code == 200
    data = response.json()

    assert data["document_name"] == "contract.txt"
    assert data["file_type"] == "txt"
    assert data["total_sections"] >= 3
    assert data["total_words"] > 0
    assert len(data["chunks"]) > 0
    assert "EMPLOYMENT CONTRACT" in data["full_text"]


def test_extract_pdf_file_upload(sample_pdf_bytes):
    files = {"file": ("agreement.pdf", io.BytesIO(sample_pdf_bytes), "application/pdf")}

    response = client.post("/api/v1/extract", files=files)
    assert response.status_code == 200
    data = response.json()

    assert data["document_name"] == "agreement.pdf"
    assert data["file_type"] == "pdf"
    assert data["total_pages"] == 2
    assert len(data["chunks"]) >= 2
    assert any(c["page_number"] == 1 for c in data["chunks"])
    assert any(c["page_number"] == 2 for c in data["chunks"])


def test_extract_docx_file_upload(sample_docx_bytes):
    files = {
        "file": (
            "nda.docx",
            io.BytesIO(sample_docx_bytes),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }

    response = client.post("/api/v1/extract", files=files)
    assert response.status_code == 200
    data = response.json()

    assert data["document_name"] == "nda.docx"
    assert data["file_type"] == "docx"
    assert any(c["chunk_type"] == "table" for c in data["chunks"])


def test_extract_from_local_path_endpoint(sample_txt_content):
    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False, encoding="utf-8") as tmp:
        tmp.write(sample_txt_content)
        tmp_path = tmp.name

    try:
        payload = {"file_path": tmp_path, "title": "my_saved_contract.txt"}
        response = client.post("/api/v1/extract-path", json=payload)
        assert response.status_code == 200
        data = response.json()

        assert data["document_name"] == "my_saved_contract.txt"
        assert data["file_type"] == "txt"
        assert len(data["chunks"]) > 0
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_extract_unsupported_file_type():
    files = {"file": ("script.py", io.BytesIO(b"print('hello')"), "text/x-python")}
    response = client.post("/api/v1/extract", files=files)
    assert response.status_code == 400
    assert "Unsupported file extension" in response.json()["detail"]


def test_extract_missing_parameters():
    response = client.post("/api/v1/extract")
    assert response.status_code == 400
    assert "Either an uploaded 'file' or a 'file_path'" in response.json()["detail"]


def test_extract_nonexistent_local_path():
    payload = {"file_path": "c:/non_existent_folder/fake_contract.pdf"}
    response = client.post("/api/v1/extract-path", json=payload)
    assert response.status_code == 404
    assert "File not found" in response.json()["detail"]
