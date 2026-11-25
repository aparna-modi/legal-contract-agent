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
    failed_items = [r for r in data["results"] if r["status"] != "pass"]
    assert all(r.get("remediation") for r in failed_items)


def test_contract_drafting_templates_and_fallback(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    tpl_res = client.get("/api/v1/draft/templates")
    assert tpl_res.status_code == 200
    templates = tpl_res.json()["templates"]
    assert len(templates) >= 5
    assert any(t["id"] == "msa" for t in templates)

    res = client.post(
        "/api/v1/draft",
        json={
            "contract_type": "nda",
            "title": "Mutual NDA — Test Corp",
            "party_a": "Alpha Labs",
            "party_b": "Beta Ventures",
            "jurisdiction": "India (Indian Contract Act, 1872)",
            "term_duration": "3 years",
            "notice_period": "15 days written notice",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert "Alpha Labs" in body["full_text"]
    assert "Beta Ventures" in body["full_text"]
    assert "not legal advice" in body["disclaimer"].lower()
    assert len(body["sections_included"]) >= 5
    assert len(body["negotiation_notes"]) >= 1


def test_prometheus_metrics_endpoint():
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "ai_http_requests_total" in res.text
    assert "ai_vector_store_total" in res.text


def test_draft_missing_clause_and_revise_draft_and_policy_rules(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    mc = client.post(
        "/api/v1/draft-clause",
        json={
            "clause_type": "Limitation of Liability",
            "document_name": "Acme MSA",
            "parties": ["Acme Corp", "Beta LLC"],
            "jurisdiction": "India (Indian Contract Act, 1872)",
            "reason": "No liability cap present.",
        },
    )
    assert mc.status_code == 200
    mc_body = mc.json()
    assert "twelve (12) months" in mc_body["suggested_clause_text"]
    assert "not legal advice" in mc_body["disclaimer"].lower()

    rev = client.post(
        "/api/v1/draft/revise",
        json={
            "title": "Acme MSA",
            "current_text": "1. SCOPE\nProvider shall deliver software engineering services to Client under this Agreement.",
            "instruction": "Add a 60-day source code escrow obligation.",
            "jurisdiction": "India",
        },
    )
    assert rev.status_code == 200
    rev_body = rev.json()
    assert "escrow" in rev_body["full_text"].lower()
    assert len(rev_body["changes_made"]) >= 1

    gen = client.post(
        "/api/v1/playbook/generate-rules",
        json={
            "policy_text": "Every agreement must cap liability, forbid unlimited liability and auto-renew, and include at least 30 days notice.",
            "jurisdiction": "India, Delaware",
        },
    )
    assert gen.status_code == 200
    gen_body = gen.json()
    assert len(gen_body["rules"]) >= 3
    assert all(r["ruleType"] in {"require_clause", "forbidden_keyword", "min_notice_days", "allowed_jurisdiction", "max_high_risk"} for r in gen_body["rules"])

