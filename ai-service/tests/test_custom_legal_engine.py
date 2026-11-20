import os
import sys

AI_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, AI_SERVICE_DIR)

from extractors.chunking import build_legal_chunks, chunk_contract_text  # noqa: E402
from services.custom_legal_engine import custom_legal_engine  # noqa: E402


SAMPLE_CONTRACT = """
SECTION 1. CONFIDENTIALITY AND NON-DISCLOSURE
Each party shall keep Confidential Information strictly confidential for three (3) years.

SECTION 2. LIMITATION OF LIABILITY
Neither party shall have unlimited liability; aggregate liability is capped at twelve months of fees.

SECTION 3. TERMINATION
Either party may terminate upon 30 days prior written notice if a material breach remains uncured.

SECTION 4. GOVERNING LAW
This Agreement is governed by the laws of India with jurisdiction in Bengaluru.
"""


def test_chunk_contract_text_returns_non_empty_windows():
    chunks = chunk_contract_text(SAMPLE_CONTRACT, chunk_size=40, overlap=10)
    assert len(chunks) >= 2
    assert all(isinstance(c, str) and c.strip() for c in chunks)


def test_build_legal_chunks_preserves_headings_and_offsets():
    doc_chunks = build_legal_chunks(SAMPLE_CONTRACT.strip(), max_tokens=200, overlap_tokens=30)
    assert len(doc_chunks) >= 4
    headings = [c.section_heading for c in doc_chunks]
    assert any("CONFIDENTIALITY" in (h or "").upper() for h in headings)
    assert any("LIABILITY" in (h or "").upper() for h in headings)
    for chunk in doc_chunks:
        assert chunk.end_char > chunk.start_char
        assert chunk.token_count > 0


def test_clause_classification_risk_and_missing_clauses():
    clauses = [
        {
            "text": "Party A may act in its sole and absolute discretion without prior notice.",
            "section_heading": "Discretion",
        },
        {
            "text": "Payments are due Net 60 from invoice receipt.",
            "section_heading": "Billing",
        },
    ]
    enriched, risk_summary, missing = custom_legal_engine.evaluate_clauses(clauses)
    assert len(enriched) == 2
    assert enriched[0]["risk_level"] == "high"
    assert enriched[1]["clause_type"] == "Payment & Fees"
    assert risk_summary["high"] == 1
    assert any(m["clause_type"] == "Limitation of Liability" for m in missing)


def test_compare_clause_lists_detects_modified_and_added():
    clauses_a = [
        {
            "clause_type": "Termination",
            "risk_level": "low",
            "text": "Either party may terminate with 30 days written notice.",
        }
    ]
    clauses_b = [
        {
            "clause_type": "Termination",
            "risk_level": "high",
            "text": "Client may terminate immediately without prior notice upon breach.",
        },
        {
            "clause_type": "Confidentiality / NDA",
            "risk_level": "low",
            "text": "Confidential information remains protected for 5 years.",
        },
    ]
    diff = custom_legal_engine.compare_clause_lists("v1", clauses_a, "v2", clauses_b)
    assert diff["summary"]["modified"] == 1
    assert diff["summary"]["added"] == 1
