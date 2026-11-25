import os
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import chromadb
import httpx
from chromadb.config import Settings

from services.embedding_service import embedding_service


class BaseVectorStore(ABC):
    @abstractmethod
    def upsert_chunks(self, user_id: str, document_id: str, chunks: List[Dict[str, Any]]) -> int: ...

    @abstractmethod
    def search(self, user_id: str, query_vector: List[float], document_id: Optional[str] = None, top_k: int = 5) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def delete_by_document(self, user_id: str, document_id: str) -> int: ...

    @abstractmethod
    def delete_by_user(self, user_id: str) -> int: ...

    @abstractmethod
    def count(self, user_id: Optional[str] = None) -> int: ...

    @abstractmethod
    def stats(self) -> Dict[str, Any]: ...


def _prepare_entries(chunks: List[Dict[str, Any]]) -> tuple[List[tuple[int, Dict[str, Any], str]], Dict[int, List[float]]]:
    valid: List[tuple[int, Dict[str, Any], str]] = []
    missing: List[tuple[int, str]] = []
    for idx, chunk in enumerate(chunks):
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        valid.append((idx, chunk, text))
        if not chunk.get("embedding"):
            heading = chunk.get("section_heading") or chunk.get("section") or ""
            ctype = chunk.get("clause_type") or ""
            prefix = f"[{ctype} | {heading}] " if ctype and heading else (f"[{heading}] " if heading else "")
            missing.append((len(valid) - 1, f"{prefix}{text}"))

    computed: Dict[int, List[float]] = {}
    if missing:
        vecs = embedding_service.embed_batch([m[1] for m in missing], task_type="RETRIEVAL_DOCUMENT")
        for (entry_idx, _), vec in zip(missing, vecs):
            computed[entry_idx] = vec
    return valid, computed


def _chunk_metadata(user_id: str, document_id: str, chunk_id: str, chunk: Dict[str, Any], text: str) -> Dict[str, Any]:
    return {
        "user_id": str(user_id),
        "document_id": str(document_id),
        "chunk_id": str(chunk_id),
        "page_number": int(chunk.get("page_number") or chunk.get("page") or 1),
        "section": str(chunk.get("section_heading") or chunk.get("section") or "General"),
        "clause_number": str(chunk.get("clause_number") or ""),
        "clause_type": str(chunk.get("clause_type") or chunk.get("chunk_type") or "clause"),
        "document_version": str(chunk.get("document_version") or "1.0"),
        "token_count": int(chunk.get("token_count") or len(text.split())),
    }


def _hit_dict(vector_id: str, text: str, score: float, meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "vector_id": vector_id,
        "chunk_id": meta.get("chunk_id", ""),
        "document_id": meta.get("document_id", ""),
        "user_id": meta.get("user_id", ""),
        "text": text,
        "similarity_score": max(0.0, min(1.0, round(score, 4))),
        "page_number": meta.get("page_number", 1),
        "section": meta.get("section", "General"),
        "clause_number": meta.get("clause_number", ""),
        "clause_type": meta.get("clause_type", "clause"),
        "document_version": meta.get("document_version", "1.0"),
        "token_count": meta.get("token_count", 0),
    }


class ChromaVectorStore(BaseVectorStore):
    def __init__(
        self,
        persist_directory: Optional[str] = None,
        collection_name: str = "legal_contracts",
        http_host: Optional[str] = None,
        http_port: int = 8001,
    ):
        self.collection_name = collection_name
        self.http_host = http_host
        self.http_port = http_port

        if http_host:
            self.persist_directory = f"http://{http_host}:{http_port}"
            self.client = chromadb.HttpClient(host=http_host, port=http_port, settings=Settings(anonymized_telemetry=False))
        else:
            self.persist_directory = persist_directory or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "chroma_db")
            os.makedirs(self.persist_directory, exist_ok=True)
            self.client = chromadb.PersistentClient(path=self.persist_directory, settings=Settings(anonymized_telemetry=False, allow_reset=True))

        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine", "description": "Legal Contract Agent Vector Index"},
        )

    def upsert_chunks(self, user_id: str, document_id: str, chunks: List[Dict[str, Any]]) -> int:
        if not user_id or not document_id or not chunks:
            return 0
        valid, computed = _prepare_entries(chunks)
        if not valid:
            return 0

        ids, embeddings, documents, metadatas = [], [], [], []
        for entry_idx, (orig_idx, chunk, text) in enumerate(valid):
            cid = chunk.get("chunk_id") or f"chunk_{orig_idx:04d}"
            ids.append(f"{user_id}_{document_id}_{cid}")
            embeddings.append(chunk.get("embedding") or computed[entry_idx])
            documents.append(text)
            metadatas.append(_chunk_metadata(user_id, document_id, cid, chunk, text))

        self.collection.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
        return len(ids)

    def search(self, user_id: str, query_vector: List[float], document_id: Optional[str] = None, top_k: int = 5) -> List[Dict[str, Any]]:
        total = self.collection.count()
        if not user_id or not query_vector or total == 0:
            return []

        where: Dict[str, Any] = {"$and": [{"user_id": str(user_id)}, {"document_id": str(document_id)}]} if document_id else {"user_id": str(user_id)}
        res = self.collection.query(
            query_embeddings=[query_vector],
            n_results=min(top_k, max(1, total)),
            where=where,
            include=["documents", "metadatas", "distances"],
        )
        if not res or not res.get("ids") or not res["ids"][0]:
            return []

        ids = res["ids"][0]
        docs = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        dists = res.get("distances", [[]])[0]
        return [
            _hit_dict(vid, docs[i] if i < len(docs) else "", 1.0 - (dists[i] if i < len(dists) else 1.0), metas[i] if i < len(metas) else {})
            for i, vid in enumerate(ids)
        ]

    def delete_by_document(self, user_id: str, document_id: str) -> int:
        if not user_id or not document_id:
            return 0
        ids = self.collection.get(where={"$and": [{"user_id": str(user_id)}, {"document_id": str(document_id)}]}).get("ids", [])
        if ids:
            self.collection.delete(ids=ids)
        return len(ids)

    def delete_by_user(self, user_id: str) -> int:
        if not user_id:
            return 0
        ids = self.collection.get(where={"user_id": str(user_id)}).get("ids", [])
        if ids:
            self.collection.delete(ids=ids)
        return len(ids)

    def count(self, user_id: Optional[str] = None) -> int:
        return len(self.collection.get(where={"user_id": str(user_id)}).get("ids", [])) if user_id else self.collection.count()

    def stats(self) -> Dict[str, Any]:
        return {
            "provider": "ChromaDB HTTP (HNSW Cosine)" if self.http_host else "ChromaDB (HNSW Cosine)",
            "collection_name": self.collection_name,
            "total_vectors": self.collection.count(),
            "persist_directory": self.persist_directory,
            "status": "ready",
        }


class QdrantVectorStore(BaseVectorStore):
    def __init__(self, url: str, collection_name: str = "legal_contracts", api_key: Optional[str] = None, dimension: int = 384):
        self.base_url = url.rstrip("/")
        self.collection_name = collection_name
        self.dimension = dimension
        self.headers: Dict[str, str] = {"Content-Type": "application/json", **({"api-key": api_key} if api_key else {})}
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        with httpx.Client(timeout=10.0) as client:
            if client.get(f"{self.base_url}/collections/{self.collection_name}", headers=self.headers).status_code == 200:
                return
            client.put(
                f"{self.base_url}/collections/{self.collection_name}",
                headers=self.headers,
                json={"vectors": {"size": self.dimension, "distance": "Cosine"}},
            ).raise_for_status()
            for field in ("user_id", "document_id"):
                client.put(
                    f"{self.base_url}/collections/{self.collection_name}/index",
                    headers=self.headers,
                    json={"field_name": field, "field_schema": "keyword"},
                )

    def upsert_chunks(self, user_id: str, document_id: str, chunks: List[Dict[str, Any]]) -> int:
        if not user_id or not document_id or not chunks:
            return 0
        valid, computed = _prepare_entries(chunks)
        if not valid:
            return 0

        points = []
        for entry_idx, (orig_idx, chunk, text) in enumerate(valid):
            cid = chunk.get("chunk_id") or f"chunk_{orig_idx:04d}"
            payload = {**_chunk_metadata(user_id, document_id, cid, chunk, text), "text": text}
            points.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{document_id}:{cid}")),
                "vector": chunk.get("embedding") or computed[entry_idx],
                "payload": payload,
            })

        with httpx.Client(timeout=20.0) as client:
            client.put(
                f"{self.base_url}/collections/{self.collection_name}/points?wait=true",
                headers=self.headers,
                json={"points": points},
            ).raise_for_status()
        return len(points)

    def search(self, user_id: str, query_vector: List[float], document_id: Optional[str] = None, top_k: int = 5) -> List[Dict[str, Any]]:
        if not user_id or not query_vector:
            return []
        must = [{"key": "user_id", "match": {"value": str(user_id)}}]
        if document_id:
            must.append({"key": "document_id", "match": {"value": str(document_id)}})

        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{self.base_url}/collections/{self.collection_name}/points/search",
                headers=self.headers,
                json={"vector": query_vector, "limit": top_k, "with_payload": True, "filter": {"must": must}},
            )
            resp.raise_for_status()
            hits = resp.json().get("result", [])

        return [_hit_dict(str(h.get("id", "")), (h.get("payload") or {}).get("text", ""), float(h.get("score", 0.0)), h.get("payload") or {}) for h in hits]

    def _count_filter(self, must: Optional[List[Dict[str, Any]]] = None) -> int:
        body: Dict[str, Any] = {"exact": True, **({"filter": {"must": must}} if must else {})}
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{self.base_url}/collections/{self.collection_name}/points/count", headers=self.headers, json=body)
            resp.raise_for_status()
            return int(resp.json().get("result", {}).get("count", 0))

    def _delete_filter(self, must: List[Dict[str, Any]]) -> int:
        before = self._count_filter(must)
        if before == 0:
            return 0
        with httpx.Client(timeout=15.0) as client:
            client.post(
                f"{self.base_url}/collections/{self.collection_name}/points/delete?wait=true",
                headers=self.headers,
                json={"filter": {"must": must}},
            ).raise_for_status()
        return before

    def delete_by_document(self, user_id: str, document_id: str) -> int:
        if not user_id or not document_id:
            return 0
        return self._delete_filter([{"key": "user_id", "match": {"value": str(user_id)}}, {"key": "document_id", "match": {"value": str(document_id)}}])

    def delete_by_user(self, user_id: str) -> int:
        return self._delete_filter([{"key": "user_id", "match": {"value": str(user_id)}}]) if user_id else 0

    def count(self, user_id: Optional[str] = None) -> int:
        return self._count_filter([{"key": "user_id", "match": {"value": str(user_id)}}]) if user_id else self._count_filter()

    def stats(self) -> Dict[str, Any]:
        return {
            "provider": "Qdrant (Distributed HNSW Cosine)",
            "collection_name": self.collection_name,
            "total_vectors": self.count(),
            "endpoint": self.base_url,
            "status": "ready",
        }


def create_vector_store() -> BaseVectorStore:
    provider = os.environ.get("VECTOR_STORE_PROVIDER", "chroma").strip().lower()
    collection = os.environ.get("VECTOR_COLLECTION_NAME", "legal_contracts").strip()
    if provider == "qdrant" and os.environ.get("QDRANT_URL"):
        return QdrantVectorStore(url=os.environ["QDRANT_URL"], collection_name=collection, api_key=os.environ.get("QDRANT_API_KEY"), dimension=embedding_service.dimension)
    if provider == "chroma-http" and os.environ.get("CHROMA_HOST"):
        return ChromaVectorStore(collection_name=collection, http_host=os.environ["CHROMA_HOST"], http_port=int(os.environ.get("CHROMA_PORT", "8001")))
    return ChromaVectorStore(collection_name=collection)


vector_store: BaseVectorStore = create_vector_store()
