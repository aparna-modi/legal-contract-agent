from fastapi.testclient import TestClient

from extractors.pdf_extractor import PDFDocumentExtractor
from main import app
from services.llm_client import llm_client
from tests.conftest import create_sample_pdf

client = TestClient(app)


def test_scanned_pdf_triggers_ocr_fallback(monkeypatch):
    # Create a valid PDF whose page contains no selectable text (simulating a scanned PDF).
    blank_pdf = create_sample_pdf([""])

    monkeypatch.setattr(
        llm_client,
        "ocr_pdf_bytes",
        lambda pdf_bytes: [
            "1. LEASE AGREEMENT\nTenant shall pay $2,500 per month on the first of each month.\n\n2. TERMINATION\nEither party may terminate with 30 days written notice."
        ],
    )

    extractor = PDFDocumentExtractor()
    result = extractor.extract_from_bytes(blank_pdf, "scanned_lease.pdf")
    assert result.metadata["ocr_used"] is True
    assert result.metadata["ocr_attempted"] is True
    assert "LEASE AGREEMENT" in result.full_text
    assert len(result.chunks) >= 2


def test_redline_suggestion_endpoint_returns_balanced_fallback(monkeypatch):
    # Force deterministic offline fallback for fast repeatable test
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    res = client.post(
        "/api/v1/redline",
        json={
            "clause_type": "Limitation of Liability",
            "clause_text": "Vendor accepts unlimited liability for all direct and indirect damages.",
            "risk_level": "high",
            "risk_reason": "Uncapped liability exposure.",
            "playbook_guidance": "Cap liability at 12 months fees.",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "twelve (12) months" in data["suggested_text"]
    assert len(data["rationale"]) > 10
    assert len(data["talking_points"]) >= 1


def test_playbook_evaluation_endpoint():
    res = client.post(
        "/api/v1/playbook/evaluate",
        json={
            "clauses": [
                {
                    "clause_type": "Termination",
                    "text": "Either party may terminate with 15 days notice.",
                    "risk_level": "medium",
                },
                {
                    "clause_type": "Indemnification",
                    "text": "Vendor agrees to unlimited liability for third-party claims.",
                    "risk_level": "high",
                },
            ],
            "missing_clauses": [],
            "key_facts": {
                "noticePeriod": "15 days",
                "governingLaw": "Texas",
            },
            "rules": [
                {
                    "id": "r1",
                    "name": "Require Liability Cap",
                    "ruleType": "require_clause",
                    "target": "Limitation of Liability",
                    "severity": "high",
                },
                {
                    "id": "r2",
                    "name": "Flag Unlimited Liability",
                    "ruleType": "forbidden_keyword",
                    "target": "unlimited liability",
                    "severity": "high",
                },
                {
                    "id": "r3",
                    "name": "Min 30-day Notice",
                    "ruleType": "min_notice_days",
                    "target": "30",
                    "severity": "medium",
                },
                {
                    "id": "r4",
                    "name": "Max 2 High Risk",
                    "ruleType": "max_high_risk",
                    "target": "2",
                    "severity": "high",
                },
            ],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["total"] == 4
    assert data["summary"]["passed"] == 1  # max_high_risk passed (1 <= 2)
    assert data["summary"]["failed"] >= 2  # missing liability + forbidden keyword
    assert 0 <= data["compliance_score"] <= 100


def test_prometheus_metrics_endpoint():
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "ai_http_requests_total" in res.text
    assert "ai_vector_store_total" in res.text
