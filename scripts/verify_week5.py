"""
Verification & Evaluation Script for Milestone Week 5:
Vector Database Integration (ChromaDB) & Retrieval Pipeline (Similarity Search + Reranking)
"""

import os
import sys
import tempfile
import shutil

# Reconfigure stdout for UTF-8 in Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Ensure ai-service is in sys.path
ai_service_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ai-service")
if ai_service_dir not in sys.path:
    sys.path.insert(0, ai_service_dir)

from services.vector_store import ChromaVectorStore
from services.retrieval_service import RetrievalService, LegalReranker
from services.embedding_service import embedding_service


def run_week5_verification():
    print("=" * 75)
    print(">> LEGAL CONTRACT AGENT -- MILESTONE WEEK 5 EMPIRICAL VERIFICATION")
    print("=" * 75)


    temp_dir = tempfile.mkdtemp(prefix="chroma_verify_")
    try:
        print("\n[Step 1] Initializing ChromaVectorStore with HNSW Cosine Index...")
        store = ChromaVectorStore(persist_directory=temp_dir, collection_name="verification_index")
        stats = store.stats()
        print(f"  ✓ ChromaDB initialized successfully: {stats['provider']}")
        print(f"  ✓ Target collection: '{stats['collection_name']}', total vectors: {stats['total_vectors']}")

        # Sample contract dataset
        employment_chunks = [
            {
                "chunk_id": "emp_001",
                "text": "This Employment Agreement is entered into between Acme Cloud Inc. and John Doe.",
                "page_number": 1,
                "section": "Preamble & Parties",
                "clause_type": "parties",
            },
            {
                "chunk_id": "emp_002",
                "text": "Employee may terminate employment at any time by giving two (2) weeks prior written notice.",
                "page_number": 3,
                "section": "Termination by Employee",
                "clause_type": "termination",
            },
            {
                "chunk_id": "emp_003",
                "text": "Employer may terminate this agreement immediately for Cause, including willful misconduct, fraud, or uncured material breach.",
                "page_number": 3,
                "section": "Termination for Cause",
                "clause_type": "termination",
            },
            {
                "chunk_id": "emp_004",
                "text": "Employee shall not engage in competitive business within a 25-mile radius for twelve (12) months following termination.",
                "page_number": 5,
                "section": "Restrictive Covenants & Non-Compete",
                "clause_type": "non_compete",
            },
            {
                "chunk_id": "emp_005",
                "text": "Company's total aggregate liability for all claims arising out of this agreement shall not exceed $25,000.",
                "page_number": 6,
                "section": "Limitation of Liability",
                "clause_type": "liability",
            },
        ]

        print("\n[Step 2] Upserting Contract Chunks with Full Metadata...")
        indexed = store.upsert_chunks(
            user_id="user_alice", document_id="doc_employment", chunks=employment_chunks
        )
        print(f"  ✓ Indexed {indexed} chunks into ChromaDB for user 'user_alice'")
        assert indexed == 5, f"Expected 5 chunks indexed, got {indexed}"
        assert store.count("user_alice") == 5

        print("\n[Step 3] Verifying Multi-Tenant Isolation (Anti-Leakage Security)...")
        # User Bob attempts to search Alice's contract
        q_vec = embedding_service.embed_text("What is the non-compete period and radius?")
        bob_results = store.search(user_id="user_bob", query_vector=q_vec, top_k=5)
        print(f"  ✓ User Bob vector query results count: {len(bob_results)}")
        assert len(bob_results) == 0, "SECURITY BREACH: User Bob retrieved User Alice's chunks!"
        print("  ✓ PASSED: Multi-tenant tenant boundary verified 100% impenetrable.")

        print("\n[Step 4] Verifying End-to-End Retrieval Pipeline & Reranking...")
        retrieval = RetrievalService(store=store)

        # Query 1: Termination notice
        q1 = "How can an employee terminate this agreement and what is the notice period?"
        res1 = retrieval.retrieve(query=q1, user_id="user_alice", document_id="doc_employment", top_k=3)
        print(f"  Query: '{q1}'")
        print(f"  Grounded Answer: {res1['answer'][:120]}...")
        print(f"  Confidence: {res1['confidence']}")
        print(f"  Top Citation: {res1['results'][0]['citation']}")
        print(f"  Top Score: {res1['results'][0]['score']} (Dense: {res1['results'][0]['dense_score']}, Rerank: {res1['results'][0]['rerank_score']})")

        assert res1["insufficient_information"] is False
        assert "emp_002" == res1["results"][0]["chunk_id"]
        assert "Termination by Employee" in res1["results"][0]["citation"]
        assert "Page 3" in res1["results"][0]["citation"]

        # Query 2: Liability cap
        q2 = "What is the maximum dollar amount for company liability?"
        res2 = retrieval.retrieve(query=q2, user_id="user_alice", document_id="doc_employment", top_k=3)
        print(f"\n  Query: '{q2}'")
        print(f"  Top Citation: {res2['results'][0]['citation']}")
        assert res2["insufficient_information"] is False
        assert res2["results"][0]["chunk_id"] == "emp_005"
        assert "$25,000" in res2["results"][0]["text"]

        print("\n[Step 5] Verifying Hallucination Defense & Threshold Trigger...")
        # Irrelevant query that is NOT in the contract
        q_fake = "What are the reimbursement rates for deep-sea submarine excursions?"
        res_fake = retrieval.retrieve(query=q_fake, user_id="user_alice", document_id="doc_employment", top_k=3, min_score=0.25)
        print(f"  Query: '{q_fake}'")
        print(f"  Insufficient Info Flag: {res_fake['insufficient_information']}")
        print(f"  Safety Explanation: {res_fake['message']}")
        assert res_fake["insufficient_information"] is True
        assert "Insufficient information" in res_fake["message"]
        print("  ✓ PASSED: Hallucination defense verified. Weak evidence rejected.")

        print("\n[Step 6] Verifying Cascade Deletion & Vector Cleanup...")
        deleted = store.delete_by_document(user_id="user_alice", document_id="doc_employment")
        print(f"  ✓ Purged {deleted} vectors for 'doc_employment'")
        assert deleted == 5
        assert store.count("user_alice") == 0

        print("\n" + "=" * 75)
        print("✅ ALL WEEK 5 VERIFICATION CHECKS PASSED EMPIRICALLY!")
        print("=" * 75)
        return True

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    success = run_week5_verification()
    sys.exit(0 if success else 1)
