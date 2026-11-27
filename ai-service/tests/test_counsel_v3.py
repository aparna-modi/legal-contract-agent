"""Comprehensive tests for Counsel Suite v3.0 features & demo-video regression fixes."""

import io
from docx import Document as DocxDocument
from fastapi.testclient import TestClient

from extractors.pdf_extractor import PDFDocumentExtractor
from main import app
from services.clause_service import clause_service, detect_missing_clauses, get_ipc_bns_reference
from services.llm_client import llm_client
from tests.conftest import create_sample_pdf

client = TestClient(app)


SAMPLE_RISKY_CONTRACT = """
MASTER SERVICES AGREEMENT

Provider: AetherGrid Cloud Systems Private Limited
Client: Kaveri Retail Ventures Private Limited
Effective Date: 15 November 2026
Governing Law: Laws of India, courts at Bengaluru

SECTION 2. SCOPE OF SERVICES AND SERVICE LEVELS
2.1 Provider shall deliver Enterprise Platform services promptly using reasonable efforts.
2.2 Provider may modify service policies from time to time at its sole discretion.

SECTION 4. FEES AND PAYMENT
4.1 Client shall pay INR 25,00,000 in advance. All advances are non-refundable and forfeited upon default.

SECTION 8. LIMITATION OF LIABILITY
8.1 Client accepts unlimited liability for all claims while Provider liability is capped at one month's fee.
8.2 Upon termination, Client agrees to a worldwide post-termination non-compete for 24 months.

SECTION 12. GOVERNING LAW AND ARBITRATION
12.1 Governed by the laws of India with arbitration in Bengaluru under the Arbitration and Conciliation Act, 1996.
12.2 Subject to Section 19, courts at Bengaluru shall have exclusive jurisdiction.
"""


def test_pdf_sticky_heading_fix_and_enterprise_key_facts(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)
    pdf_bytes = create_sample_pdf([
        "SECTION 2. SCOPE OF SERVICES\n2.1 Provider delivers cloud platform services to Client.\n"
        "SECTION 12. GOVERNING LAW AND JURISDICTION\n12.1 This Agreement is governed by the laws of India and courts in Bengaluru."
    ])
    ext = PDFDocumentExtractor().extract_from_bytes(pdf_bytes, "enterprise_msa.pdf")
    gov_chunks = [c for c in ext.chunks if "Bengaluru" in c.text]
    assert gov_chunks, "Expected Governing Law chunk"
    assert "12" in (gov_chunks[0].section_heading or "") or "GOVERNING LAW" in (gov_chunks[0].section_heading or "").upper()

    classified = clause_service.process_chunks_into_clauses([c.model_dump() for c in ext.chunks])
    res = client.post(
        "/api/v1/analyze",
        json={
            "document_name": "Enterprise MSA",
            "full_text": SAMPLE_RISKY_CONTRACT,
            "classified_clauses": classified,
            "user_party": "Kaveri Retail Ventures Private Limited",
            "user_role": "client_buyer",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "AetherGrid Cloud Systems Private Limited" in data["key_facts"]["parties"]
    assert "Kaveri Retail Ventures Private Limited" in data["key_facts"]["parties"]
    assert "15 November 2026" in data["key_facts"]["effective_date"]
    assert "India" in data["key_facts"]["governing_law"]
    # Arbitration is present in Section 12 — must NOT be falsely flagged missing
    missing_types = {m["clause_type"] for m in data["missing_clauses"]}
    assert "Dispute Resolution & Arbitration" not in missing_types
    assert "scorecard" in data
    assert 0 <= data["scorecard"]["overall_health"] <= 100
    assert 0 <= data["scorecard"]["loophole_score"] <= 100
    assert 0 <= data["scorecard"]["user_favorability"] <= 100


def test_loophole_audit_and_section_4a_draft_hardening(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    audit_res = client.post(
        "/api/v1/loopholes/audit",
        json={
            "document_name": "Initial Vendor Draft",
            "full_text": SAMPLE_RISKY_CONTRACT,
            "user_role": "client_buyer",
            "mode": "hardening",
        },
    )
    assert audit_res.status_code == 200
    audit = audit_res.json()
    assert audit["counts"]["total"] >= 4
    cats = {lp["category"] for lp in audit["loopholes"]}
    assert "escape_hatch" in cats or "ambiguous_standard" in cats
    assert "cross_reference_conflict" in cats  # Section 19 does not exist
    assert "statutory_vulnerability" in cats   # Post-termination non-compete Sec. 27

    harden_res = client.post(
        "/api/v1/draft/harden",
        json={
            "title": "Initial Vendor Draft",
            "draft_text": SAMPLE_RISKY_CONTRACT,
            "loopholes_to_fix": audit["loopholes"][:5],
            "jurisdiction": "India (Indian Contract Act, 1872)",
        },
    )
    assert harden_res.status_code == 200
    hardened = harden_res.json()
    assert "sole discretion" not in hardened["hardened_text"].lower()
    assert "five (5) business days" in hardened["hardened_text"].lower()
    assert len(hardened["resolutions_applied"]) >= 1
    assert hardened["post_hardening_scorecard"]["overall_health"] >= 0


def test_user_only_protective_rewrite(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    res = client.post(
        "/api/v1/contracts/rewrite-user-only",
        json={
            "document_name": "Vendor Skewed MSA",
            "full_text": SAMPLE_RISKY_CONTRACT,
            "classified_clauses": [
                {"clause_type": "Limitation of Liability", "text": "Client accepts unlimited liability.", "risk_level": "high", "page_number": 2}
            ],
            "user_party": "Kaveri Retail Ventures Private Limited",
            "user_role": "client_buyer",
            "aggressiveness": "maximum_user_only",
            "jurisdiction": "India (Indian Contract Act, 1872)",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["before_after_metrics"]["user_protection_after"] > body["before_after_metrics"]["user_protection_before"]
    assert body["before_after_metrics"]["risk_after"] < body["before_after_metrics"]["risk_before"]
    assert "unlimited liability" not in body["rewritten_full_text"].lower()
    assert len(body["clause_transformations"]) >= 1
    assert len(body["inserted_protections"]) >= 1


def test_ipc_bns_case_strategy_and_legal_notice(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    ipc_ref = get_ipc_bns_reference("Payment Terms & Consideration", "Advance amount forfeited after cheque dishonour and fraud.")
    assert "BNS" in ipc_ref and "IPC" in ipc_ref

    strat = client.post(
        "/api/v1/counsel/case-strategy",
        json={
            "document_name": "Enterprise MSA",
            "full_text": SAMPLE_RISKY_CONTRACT,
            "classified_clauses": [
                {"clause_type": "Payment Terms & Consideration", "text": "Client paid INR 25,00,000 advance.", "risk_level": "high", "page_number": 1},
                {"clause_type": "Dispute Resolution & Arbitration", "text": "Arbitration in Bengaluru.", "risk_level": "low", "page_number": 2},
            ],
            "represented_party": "Kaveri Retail Ventures Private Limited",
            "user_role": "client_buyer",
            "posture": "claimant",
            "dispute_facts": "Provider collected INR 25,00,000 advance and abandoned delivery while retaining client data.",
        },
    )
    assert strat.status_code == 200
    s_body = strat.json()
    assert len(s_body["civil_remedies"]) >= 2
    assert len(s_body["criminal_ipc_bns_tracks"]) >= 2
    assert any("420" in t["ipc_section"] and "318" in t["bns_section"] for t in s_body["criminal_ipc_bns_tracks"])
    assert any("63" in e["document_or_proof"] for e in s_body["evidence_checklist"])
    assert len(s_body["procedural_roadmap"]) >= 4

    notice = client.post(
        "/api/v1/counsel/legal-notice",
        json={
            "document_name": "Enterprise MSA",
            "parties": ["Kaveri Retail Ventures Private Limited", "AetherGrid Cloud Systems Private Limited"],
            "effective_date": "15 November 2026",
            "governing_law": "India",
            "represented_party": "Kaveri Retail Ventures Private Limited",
            "counterparty_name": "AetherGrid Cloud Systems Private Limited",
            "dispute_facts": "Failure to deliver platform after collecting INR 25,00,000 advance.",
        },
    )
    assert notice.status_code == 200
    n_body = notice.json()
    assert "WITHOUT PREJUDICE" in n_body["notice_text"]
    assert "Kaveri Retail Ventures Private Limited" in n_body["notice_text"]
    assert "AetherGrid Cloud Systems Private Limited" in n_body["notice_text"]


def test_senior_counsel_drafting_baselines_negotiation_email_and_docx_export(monkeypatch):
    monkeypatch.setattr(llm_client, "generate_structured", lambda **kwargs: None)

    tpls = client.get("/api/v1/draft/templates").json()["templates"]
    assert len(tpls) == 12
    assert any(t["id"] == "sale_agreement" for t in tpls)
    assert any(t["id"] == "founders" for t in tpls)

    draft = client.post(
        "/api/v1/draft",
        json={
            "contract_type": "msa",
            "title": "Enterprise MSA",
            "party_a": "Orion Tech Pvt. Ltd.",
            "party_b": "Vertex Systems Ltd.",
            "stance": "protect_user_only",
            "representing_party": "party_a",
            "jurisdiction": "India (Indian Contract Act, 1872)",
        },
    )
    assert draft.status_code == 200
    d_body = draft.json()
    assert "RECITALS" in d_body["full_text"]
    assert "DEFINITIONS AND INTERPRETATION" in d_body["full_text"]
    assert "SCHEDULE A" in d_body["full_text"]
    assert "WITNESSES:" in d_body["full_text"]
    assert d_body["presentation_baseline"]["presentation_score"] >= 90
    assert len(d_body["counsel_annotations"]) >= 3

    # Section 4(b) Standardize Baseline + Benchmark
    rough_draft = "Agreement between Alpha and Beta. Alpha pays INR 10,000. Beta delivers code. India law applies."
    std = client.post(
        "/api/v1/draft/standardize-baseline",
        json={"title": "Software Dev Baseline", "draft_text": rough_draft, "jurisdiction": "India"},
    )
    assert std.status_code == 200
    std_body = std.json()
    assert std_body["after_baseline"]["presentation_score"] > std_body["before_baseline"]["presentation_score"]

    bench = client.post(
        "/api/v1/baseline/benchmark",
        json={
            "baseline_title": "Firm Gold MSA",
            "baseline_text": d_body["full_text"],
            "target_title": "Rough Incoming Draft",
            "target_text": rough_draft,
        },
    )
    assert bench.status_code == 200
    b_body = bench.json()
    assert b_body["conformity_score"] < 80
    assert len(b_body["missing_baseline_sections"]) >= 3

    # Negotiation email
    email_res = client.post(
        "/api/v1/negotiation/email",
        json={
            "document_name": "Enterprise MSA",
            "represented_party": "Orion Tech Pvt. Ltd.",
            "counterparty_name": "Vertex Systems Ltd.",
            "tone": "firm",
            "deal_breakers": ["Uncapped liability exposure"],
        },
    )
    assert email_res.status_code == 200
    assert "Vertex Systems Ltd." in email_res.json()["email_body"]

    # Publication-grade DOCX binary export
    docx_res = client.post(
        "/api/v1/export/docx",
        json={
            "title": d_body["title"],
            "full_text": d_body["full_text"],
            "jurisdiction": d_body["jurisdiction"],
            "counsel_notes": d_body["negotiation_notes"],
            "disclaimer": d_body["disclaimer"],
        },
    )
    assert docx_res.status_code == 200
    assert docx_res.content[:2] == b"PK"  # Valid ZIP/DOCX signature
    parsed_doc = DocxDocument(io.BytesIO(docx_res.content))
    full_docx_text = "\n".join(p.text for p in parsed_doc.paragraphs)
    assert "ENTERPRISE MSA" in full_docx_text
    assert "Orion Tech Pvt. Ltd." in full_docx_text
    assert len(parsed_doc.tables) >= 2  # Schedule tables + signature table


def test_playbook_new_v3_rules():
    res = client.post(
        "/api/v1/playbook/evaluate",
        json={
            "clauses": [
                {
                    "clause_type": "Termination",
                    "text": "Provider may modify terms from time to time at its sole discretion. Breach must be cured within 10 days.",
                    "risk_level": "high",
                },
                {
                    "clause_type": "Limitation of Liability",
                    "text": "Aggregate liability shall not exceed 24 months fees.",
                    "risk_level": "medium",
                },
            ],
            "missing_clauses": [],
            "key_facts": {},
            "rules": [
                {"id": "v1", "name": "Forbid Unilateral Amendment", "ruleType": "forbid_unilateral_amendment", "target": "true", "severity": "high"},
                {"id": "v2", "name": "Minimum 30-Day Cure", "ruleType": "require_cure_period_days", "target": "30", "severity": "high"},
                {"id": "v3", "name": "Max 12-Month Cap", "ruleType": "max_liability_cap_months", "target": "12", "severity": "medium"},
                {"id": "v4", "name": "Define Confidential Info", "ruleType": "require_defined_term", "target": "Confidential Information", "severity": "medium"},
            ],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["total"] == 4
    assert data["summary"]["failed"] >= 2
    assert data["summary"]["warned"] >= 2 or data["summary"]["failed"] >= 3
