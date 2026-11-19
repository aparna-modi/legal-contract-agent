from fastapi.testclient import TestClient

from main import app
from services.analysis_service import analysis_service
from services.clause_service import (
    clause_service,
    detect_missing_clauses,
    summarize_risk_profile,
)

client = TestClient(app)


def test_clause_risk_and_missing_clause_detection():
    raw_chunks = [
        {
            "chunk_id": 1,
            "text": "Vendor agrees to indemnify and hold harmless Client against any and all claims arising from this agreement without limitation.",
            "section_heading": "Indemnification",
            "page_number": 2,
        },
        {
            "chunk_id": 2,
            "text": "This agreement shall be governed by the laws of the State of Delaware.",
            "section_heading": "Governing Law",
            "page_number": 4,
        },
    ]

    classified = clause_service.process_chunks_into_clauses(raw_chunks)
    assert len(classified) == 2
    assert classified[0]["clause_type"] == "Indemnity & Defense"
    assert classified[0]["risk_level"] == "high"

    missing = detect_missing_clauses(classified)
    missing_types = {m["clause_type"] for m in missing}
    assert "Termination" in missing_types
    assert "Limitation of Liability" in missing_types
    assert "Governing Law & Jurisdiction" not in missing_types

    risk_summary = summarize_risk_profile(classified, missing)
    assert risk_summary["high"] == 1
    assert risk_summary["overall_level"] in ("medium", "high")
    assert 0 <= risk_summary["score"] <= 100


def test_analyze_contract_endpoint(monkeypatch):
    # Force deterministic offline path so unit test stays fast and predictable.
    monkeypatch.setattr("services.analysis_service.llm_client.generate_structured", lambda **kwargs: None)

    payload = {
        "document_name": "Services_Agreement.pdf",
        "full_text": (
            "This Agreement is entered into between Acme Cloud Inc. and Northstar Consulting LLC "
            "effective January 15, 2026 for an initial term of 12 months. "
            "Client shall pay $12,000 per month within 30 days of invoice. "
            "Either party may terminate with 30 days prior written notice. "
            "This agreement is governed by the laws of New York."
        ),
        "classified_clauses": [
            {
                "clause_type": "Payment Terms & Consideration",
                "text": "Client shall pay $12,000 per month within 30 days of invoice.",
                "risk_level": "low",
            },
            {
                "clause_type": "Termination",
                "text": "Either party may terminate with 30 days prior written notice.",
                "risk_level": "medium",
            },
        ],
    }

    res = client.post("/api/v1/analyze", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["executive_summary"]
    assert data["key_facts"]["effective_date"] == "January 15, 2026"
    assert "$12,000" in data["key_facts"]["payment_terms"]
    assert "30 days" in data["key_facts"]["notice_period"].lower()
    assert "New York" in data["key_facts"]["governing_law"]
    assert len(data["missing_clauses"]) > 0
    assert data["risk_summary"]["medium"] == 1


def test_compare_contracts_endpoint(monkeypatch):
    monkeypatch.setattr("services.analysis_service.llm_client.generate_structured", lambda **kwargs: None)

    payload = {
        "contract_a_title": "Vendor MSA v1",
        "clauses_a": [
            {
                "clause_type": "Termination",
                "text": "Either party may terminate this agreement upon 30 days prior written notice.",
                "risk_level": "medium",
            },
            {
                "clause_type": "Limitation of Liability",
                "text": "Total aggregate liability shall not exceed $50,000.",
                "risk_level": "medium",
            },
            {
                "clause_type": "Force Majeure",
                "text": "Neither party is liable for delays caused by acts of God or natural disasters.",
                "risk_level": "low",
            },
        ],
        "contract_b_title": "Vendor MSA v2",
        "clauses_b": [
            {
                "clause_type": "Termination",
                "text": "Vendor may terminate immediately without notice upon any missed payment.",
                "risk_level": "high",
            },
            {
                "clause_type": "Limitation of Liability",
                "text": "Total aggregate liability shall not exceed $50,000.",
                "risk_level": "medium",
            },
            {
                "clause_type": "Confidentiality & Non-Disclosure",
                "text": "All proprietary information shall remain strictly confidential for five years.",
                "risk_level": "low",
            },
        ],
    }

    res = client.post("/api/v1/compare", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["counts"]["unchanged"] == 1
    assert data["counts"]["modified"] == 1
    assert data["counts"]["added"] == 1
    assert data["counts"]["removed"] == 1
    assert data["executive_summary"]
    assert len(data["material_changes"]) >= 1
