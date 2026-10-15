"""
Vector Search & Grounded Retrieval Pipeline Verification.
Validates ChromaDB vector persistence, multi-tenant isolation, reranking, and citation accuracy.
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
from services.retrieval_service import RetrievalService
from services.embedding_service import embedding_service


def verify_pipeline():
    print("=" * 70)
    print("Running Pipeline Verification: Vector Store & Retrieval Engine")
    print("=" * 70)

    temp_dir = tempfile.mkdtemp(prefix="chroma_test_")
    try:
        print("\n[1/6] Initializing vector store with cosine metric...")
        store = ChromaVectorStore(persist_directory=temp_dir, collection_name="test_index")
        stats = store.stats()
        print(f"  -> Provider: {stats['provider']}")
        print(f"  -> Collection: '{stats['collection_name']}'")

        # Sample contract dataset
        sample_chunks = [
            {
                "chunk_id": "chunk_001",
                "text": "This Employment Agreement is entered into between Acme Cloud Inc. and John Doe.",
                "page_number": 1,
                "section": "Preamble & Parties",
                "clause_type": "parties",
            },
            {
                "chunk_id": "chunk_002",
                "text": "Employee may terminate employment at any time by giving two (2) weeks prior written notice.",
                "page_number": 3,
                "section": "Termination by Employee",
                "clause_type": "termination",
            },
            {
                "chunk_id": "chunk_003",
                "text": "Employer may terminate this agreement immediately for Cause, including willful misconduct, fraud, or uncured material breach.",
                "page_number": 3,
                "section": "Termination for Cause",
                "clause_type": "termination",
            },
            {
                "chunk_id": "chunk_004",
                "text": "Employee shall not engage in competitive business within a 25-mile radius for twelve (12) months following termination.",
                "page_number": 5,
                "section": "Restrictive Covenants & Non-Compete",
                "clause_type": "non_compete",
            },
            {
                "chunk_id": "chunk_005",
                "text": "Company's total aggregate liability for all claims arising out of this agreement shall not exceed $25,000.",
                "page_number": 6,
                "section": "Limitation of Liability",
                "clause_type": "liability",
            },
        ]

        print("\n[2/6] Indexing sample contract clauses with metadata...")
        indexed = store.upsert_chunks(
            user_id="user_alice", document_id="doc_employment", chunks=sample_chunks
        )
        print(f"  -> Indexed {indexed} clauses for user 'user_alice'")
        assert indexed == 5, f"Expected 5 chunks indexed, got {indexed}"
        assert store.count("user_alice") == 5

        print("\n[3/6] Verifying multi-tenant isolation...")
        q_vec = embedding_service.embed_text("What is the non-compete period and radius?")
        bob_results = store.search(user_id="user_bob", query_vector=q_vec, top_k=5)
        print(f"  -> Cross-user query result count: {len(bob_results)}")
        assert len(bob_results) == 0, "Security isolation failed: User Bob retrieved User Alice data"
        print("  -> Passed: User data isolation verified.")

        print("\n[4/6] Verifying semantic retrieval and reranking...")
        retrieval = RetrievalService(store=store)

        q1 = "How can an employee terminate this agreement and what is the notice period?"
        res1 = retrieval.retrieve(query=q1, user_id="user_alice", document_id="doc_employment", top_k=3)
        print(f"  Query: '{q1}'")
        print(f"  Confidence: {res1['confidence']}")
        print(f"  Citation: {res1['results'][0]['citation']}")

        assert res1["insufficient_information"] is False
        assert "chunk_002" == res1["results"][0]["chunk_id"]
        assert "Termination by Employee" in res1["results"][0]["citation"]

        q2 = "What is the maximum dollar amount for company liability?"
        res2 = retrieval.retrieve(query=q2, user_id="user_alice", document_id="doc_employment", top_k=3)
        assert res2["insufficient_information"] is False
        assert res2["results"][0]["chunk_id"] == "chunk_005"
        assert "$25,000" in res2["results"][0]["text"]

        print("\n[5/6] Verifying confidence threshold for unrelated queries...")
        q_fake = "What are the reimbursement rates for deep-sea submarine excursions?"
        res_fake = retrieval.retrieve(query=q_fake, user_id="user_alice", document_id="doc_employment", top_k=3, min_score=0.25)
        print(f"  Query: '{q_fake}'")
        print(f"  Insufficient Info Flag: {res_fake['insufficient_information']}")
        assert res_fake["insufficient_information"] is True
        assert "Insufficient information" in res_fake["message"]
        print("  -> Passed: Low-confidence query correctly rejected.")

        print("\n[6/6] Verifying document vector cleanup...")
        deleted = store.delete_by_document(user_id="user_alice", document_id="doc_employment")
        print(f"  -> Deleted {deleted} vectors for 'doc_employment'")
        assert deleted == 5
        assert store.count("user_alice") == 0

        print("\n" + "=" * 70)
        print("All verification checks passed successfully.")
        print("=" * 70)
        return True

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    success = verify_pipeline()
    sys.exit(0 if success else 1)
