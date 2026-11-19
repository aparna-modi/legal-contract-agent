import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings

from services.embedding_service import embedding_service


class BaseVectorStore(ABC):
    """Vector store adapter interface so ChromaDB can be swapped for Qdrant later."""

    @abstractmethod
    def upsert_chunks(
        self,
        user_id: str,
        document_id: str,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """Upsert document chunks along with embeddings and citation metadata."""

    @abstractmethod
    def search(
        self,
        user_id: str,
        query_vector: List[float],
        document_id: Optional[str] = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Run similarity search filtered strictly by user_id (and optional document_id)."""

    @abstractmethod
    def delete_by_document(self, user_id: str, document_id: str) -> int:
        """Delete all vectors belonging to a specific document and user."""

    @abstractmethod
    def delete_by_user(self, user_id: str) -> int:
        """Delete all vectors owned by a user."""

    @abstractmethod
    def count(self, user_id: Optional[str] = None) -> int:
        """Return total vector count or vector count for a specific user."""

    @abstractmethod
    def stats(self) -> Dict[str, Any]:
        """Return operational telemetry for the vector store."""


class ChromaVectorStore(BaseVectorStore):
    """Persistent ChromaDB store using HNSW cosine indexing and tenant-scoped queries."""

    def __init__(
        self,
        persist_directory: Optional[str] = None,
        collection_name: str = "legal_contracts",
    ):
        if not persist_directory:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            persist_directory = os.path.join(base_dir, "chroma_db")

        self.persist_directory = persist_directory
        self.collection_name = collection_name
        os.makedirs(self.persist_directory, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=self.persist_directory,
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )

        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine", "description": "Legal Contract Agent Vector Index"},
        )

    def upsert_chunks(
        self,
        user_id: str,
        document_id: str,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """Batch upsert contract chunks with deterministic tenant-scoped vector IDs."""
        if not user_id or not document_id or not chunks:
            return 0

        valid_entries: List[tuple[int, Dict[str, Any], str]] = []
        missing_embed_inputs: List[tuple[int, str]] = []

        for idx, chunk in enumerate(chunks):
            text = (chunk.get("text") or "").strip()
            if not text:
                continue
            valid_entries.append((idx, chunk, text))
            if not chunk.get("embedding"):
                heading = chunk.get("section_heading") or chunk.get("section") or ""
                ctype = chunk.get("clause_type") or ""
                prefix = f"[{ctype} | {heading}] " if ctype and heading else (f"[{heading}] " if heading else "")
                missing_embed_inputs.append((len(valid_entries) - 1, f"{prefix}{text}"))

        if not valid_entries:
            return 0

        computed_embeddings: Dict[int, List[float]] = {}
        if missing_embed_inputs:
            batch_texts = [item[1] for item in missing_embed_inputs]
            batch_vecs = embedding_service.embed_batch(batch_texts, task_type="RETRIEVAL_DOCUMENT")
            for (entry_idx, _), vec in zip(missing_embed_inputs, batch_vecs):
                computed_embeddings[entry_idx] = vec

        ids: List[str] = []
        embeddings: List[List[float]] = []
        documents: List[str] = []
        metadatas: List[Dict[str, Any]] = []

        for entry_idx, (orig_idx, chunk, text) in enumerate(valid_entries):
            raw_chunk_id = chunk.get("chunk_id") or f"chunk_{orig_idx:04d}"
            vector_id = f"{user_id}_{document_id}_{raw_chunk_id}"
            embedding = chunk.get("embedding") or computed_embeddings[entry_idx]

            meta: Dict[str, Any] = {
                "user_id": str(user_id),
                "document_id": str(document_id),
                "chunk_id": str(raw_chunk_id),
                "page_number": int(chunk.get("page_number") or chunk.get("page") or 1),
                "section": str(chunk.get("section_heading") or chunk.get("section") or "General"),
                "clause_number": str(chunk.get("clause_number") or ""),
                "clause_type": str(chunk.get("clause_type") or chunk.get("chunk_type") or "clause"),
                "document_version": str(chunk.get("document_version") or "1.0"),
                "token_count": int(chunk.get("token_count") or len(text.split())),
            }

            ids.append(vector_id)
            embeddings.append(embedding)
            documents.append(text)
            metadatas.append(meta)

        self.collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        return len(ids)

    def search(
        self,
        user_id: str,
        query_vector: List[float],
        document_id: Optional[str] = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Run cosine similarity search strictly scoped to user_id (and optional document_id)."""
        if not user_id or not query_vector:
            return []

        if document_id:
            where_clause: Dict[str, Any] = {
                "$and": [
                    {"user_id": str(user_id)},
                    {"document_id": str(document_id)},
                ]
            }
        else:
            where_clause = {"user_id": str(user_id)}

        total_items = self.collection.count()
        if total_items == 0:
            return []

        effective_k = min(top_k, max(1, total_items))

        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=effective_k,
            where=where_clause,
            include=["documents", "metadatas", "distances"],
        )

        if not results or not results.get("ids") or not results["ids"][0]:
            return []

        ids = results["ids"][0]
        docs = results["documents"][0] if results.get("documents") else []
        metas = results["metadatas"][0] if results.get("metadatas") else []
        distances = results["distances"][0] if results.get("distances") else []

        output: List[Dict[str, Any]] = []
        for i, vec_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            doc_text = docs[i] if i < len(docs) else ""
            dist = distances[i] if i < len(distances) else 1.0

            # Chroma cosine distance spans [0, 2]; convert to similarity in [0, 1].
            sim_score = max(0.0, min(1.0, round(1.0 - dist, 4)))

            output.append(
                {
                    "vector_id": vec_id,
                    "chunk_id": meta.get("chunk_id", ""),
                    "document_id": meta.get("document_id", ""),
                    "user_id": meta.get("user_id", ""),
                    "text": doc_text,
                    "similarity_score": sim_score,
                    "page_number": meta.get("page_number", 1),
                    "section": meta.get("section", "General"),
                    "clause_number": meta.get("clause_number", ""),
                    "clause_type": meta.get("clause_type", "clause"),
                    "document_version": meta.get("document_version", "1.0"),
                    "token_count": meta.get("token_count", 0),
                }
            )

        return output

    def delete_by_document(self, user_id: str, document_id: str) -> int:
        if not user_id or not document_id:
            return 0

        where_clause = {
            "$and": [
                {"user_id": str(user_id)},
                {"document_id": str(document_id)},
            ]
        }

        existing = self.collection.get(where=where_clause)
        ids_to_delete = existing.get("ids", [])
        if ids_to_delete:
            self.collection.delete(ids=ids_to_delete)
        return len(ids_to_delete)

    def delete_by_user(self, user_id: str) -> int:
        if not user_id:
            return 0

        existing = self.collection.get(where={"user_id": str(user_id)})
        ids_to_delete = existing.get("ids", [])
        if ids_to_delete:
            self.collection.delete(ids=ids_to_delete)
        return len(ids_to_delete)

    def count(self, user_id: Optional[str] = None) -> int:
        if user_id:
            res = self.collection.get(where={"user_id": str(user_id)})
            return len(res.get("ids", []))
        return self.collection.count()

    def stats(self) -> Dict[str, Any]:
        return {
            "provider": "ChromaDB (HNSW Cosine)",
            "collection_name": self.collection_name,
            "total_vectors": self.collection.count(),
            "persist_directory": self.persist_directory,
            "status": "ready",
        }


vector_store = ChromaVectorStore()
