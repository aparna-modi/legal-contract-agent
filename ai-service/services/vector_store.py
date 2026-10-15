import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import chromadb
from chromadb.config import Settings

from services.embedding_service import embedding_service


class BaseVectorStore(ABC):
    """
    Abstract Vector Store Adapter Interface.
    Enables zero-friction development with ChromaDB/FAISS and future seamless
    migration to Qdrant or enterprise vector databases without code modifications.
    """

    @abstractmethod
    def upsert_chunks(
        self,
        user_id: str,
        document_id: str,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """Upsert a list of document chunks with embeddings and metadata."""
        pass

    @abstractmethod
    def search(
        self,
        user_id: str,
        query_vector: List[float],
        document_id: Optional[str] = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Perform multi-tenant similarity search filtered by user_id and optional document_id."""
        pass

    @abstractmethod
    def delete_by_document(self, user_id: str, document_id: str) -> int:
        """Delete all vectors associated with a specific document and user."""
        pass

    @abstractmethod
    def delete_by_user(self, user_id: str) -> int:
        """Delete all vectors owned by a user."""
        pass

    @abstractmethod
    def count(self, user_id: Optional[str] = None) -> int:
        """Return total vector count or vector count for a specific user."""
        pass

    @abstractmethod
    def stats(self) -> Dict[str, Any]:
        """Return health and storage telemetry."""
        pass


class ChromaVectorStore(BaseVectorStore):
    """
    Production-grade ChromaDB Vector Store Implementation.
    - Persistent disk storage with automatic collection lifecycle.
    - Strict multi-tenant isolation via mandatory user_id metadata filtering.
    - Cosine similarity HNSW index.
    - Supports full legal chunk metadata schema.
    """

    def __init__(
        self,
        persist_directory: Optional[str] = None,
        collection_name: str = "legal_contracts",
    ):
        if not persist_directory:
            # Default to local directory inside ai-service
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            persist_directory = os.path.join(base_dir, "chroma_db")

        self.persist_directory = persist_directory
        self.collection_name = collection_name
        os.makedirs(self.persist_directory, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=self.persist_directory,
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )

        # Initialize collection with cosine similarity space
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
        """
        Batch upsert chunks into ChromaDB.
        Generates deterministic IDs and attaches complete legal metadata for citation and isolation.
        """
        if not user_id or not document_id or not chunks:
            return 0

        ids: List[str] = []
        embeddings: List[List[float]] = []
        documents: List[str] = []
        metadatas: List[Dict[str, Any]] = []

        for idx, chunk in enumerate(chunks):
            # Resolve chunk ID
            raw_chunk_id = chunk.get("chunk_id") or f"chunk_{idx:04d}"
            vector_id = f"{user_id}_{document_id}_{raw_chunk_id}"

            text = chunk.get("text", "").strip()
            if not text:
                continue

            # Resolve or compute embedding
            embedding = chunk.get("embedding")
            if not embedding:
                # Include section heading for stronger contextual indexing
                heading = chunk.get("section_heading") or chunk.get("section") or ""
                embed_input = f"{heading}: {text}" if heading else text
                embedding = embedding_service.embed_text(embed_input)

            # Metadata schema adhering to OJT Project Design document
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

        if not ids:
            return 0

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
        """
        Execute multi-tenant semantic similarity search.
        Enforces user_id filtering to guarantee zero cross-user vector leakage.
        """
        if not user_id or not query_vector:
            return []

        # Construct multi-tenant where clause
        if document_id:
            where_clause = {
                "$and": [
                    {"user_id": str(user_id)},
                    {"document_id": str(document_id)},
                ]
            }
        else:
            where_clause = {"user_id": str(user_id)}

        # Cap top_k to available vectors or sensible limit
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

        output: List[Dict[str, Any]] = []

        if not results or not results.get("ids") or not results["ids"][0]:
            return output

        ids = results["ids"][0]
        docs = results["documents"][0] if results.get("documents") else []
        metas = results["metadatas"][0] if results.get("metadatas") else []
        distances = results["distances"][0] if results.get("distances") else []

        for i, vec_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            doc_text = docs[i] if i < len(docs) else ""
            dist = distances[i] if i < len(distances) else 1.0

            # Cosine distance in Chroma ranges from 0 (identical) to 2 (opposite)
            # Cosine similarity = 1.0 - distance
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
        """Purge all vector entries belonging to a specific document under user_id."""
        if not user_id or not document_id:
            return 0

        where_clause = {
            "$and": [
                {"user_id": str(user_id)},
                {"document_id": str(document_id)},
            ]
        }

        # Query existing IDs to determine deleted count
        existing = self.collection.get(where=where_clause)
        ids_to_delete = existing.get("ids", [])
        if ids_to_delete:
            self.collection.delete(ids=ids_to_delete)

        return len(ids_to_delete)

    def delete_by_user(self, user_id: str) -> int:
        """Purge all vectors owned by a user."""
        if not user_id:
            return 0

        existing = self.collection.get(where={"user_id": str(user_id)})
        ids_to_delete = existing.get("ids", [])
        if ids_to_delete:
            self.collection.delete(ids=ids_to_delete)

        return len(ids_to_delete)

    def count(self, user_id: Optional[str] = None) -> int:
        """Count total vectors or vectors for a specific user."""
        if user_id:
            res = self.collection.get(where={"user_id": str(user_id)})
            return len(res.get("ids", []))
        return self.collection.count()

    def stats(self) -> Dict[str, Any]:
        """Return operational telemetry."""
        return {
            "provider": "ChromaDB (HNSW Cosine)",
            "collection_name": self.collection_name,
            "total_vectors": self.collection.count(),
            "persist_directory": self.persist_directory,
            "status": "ready",
        }


# Global vector store instance
vector_store = ChromaVectorStore()
