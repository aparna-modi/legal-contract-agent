import hashlib
import math
import os
import re
from typing import List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

from extractors.base import DocumentChunk

# Weighted legal vocabulary used by the local fallback vectorizer and the reranker.
LEGAL_KEYWORDS = {
    "indemnity": 3.0,
    "indemnify": 3.0,
    "hold harmless": 3.2,
    "liability": 2.8,
    "limitation of liability": 3.5,
    "termination": 2.5,
    "terminate": 2.2,
    "breach": 2.4,
    "confidentiality": 2.6,
    "confidential": 2.3,
    "intellectual property": 2.8,
    "proprietary": 2.0,
    "governing law": 2.7,
    "jurisdiction": 2.5,
    "arbitration": 2.6,
    "dispute resolution": 2.8,
    "warranty": 2.2,
    "disclaimer": 2.3,
    "non-compete": 3.0,
    "non-disclosure": 2.7,
    "severability": 2.0,
    "force majeure": 2.8,
    "payment": 2.0,
    "consideration": 2.0,
    "obligations": 1.8,
    "covenant": 2.0,
    "remedy": 2.2,
    "injunction": 2.5,
    "assignment": 2.0,
    "subcontractor": 2.0,
    "renewal": 2.2,
    "auto-renewal": 2.6,
}

DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"


def l2_normalize(vec: List[float]) -> List[float]:
    """Scale a vector to unit length so cosine similarity equals the dot product."""
    norm = math.sqrt(sum(x * x for x in vec))
    if norm <= 1e-9:
        return [0.0] * len(vec)
    return [round(x / norm, 6) for x in vec]


class DeterministicLegalVectorizer:
    """
    Offline fallback vectorizer producing unit-normalized 384-d vectors via
    weighted token hashing, stemmed bi-grams, and character 4-grams.
    """

    def __init__(self, dimension: int = 384):
        self.dimension = dimension

    def _hash_token(self, token: str, seed: int) -> int:
        digest = hashlib.sha256(f"{token}_{seed}".encode("utf-8")).digest()
        return int.from_bytes(digest[:4], "little", signed=True)

    @staticmethod
    def _stem(token: str) -> str:
        for suffix in ("ing", "tion", "ment", "ed", "es", "s", "able", "al"):
            if token.endswith(suffix) and len(token) - len(suffix) >= 3:
                return token[: -len(suffix)]
        return token

    def vectorize(self, text: str) -> List[float]:
        if not text or not text.strip():
            return [0.0] * self.dimension

        cleaned = text.lower()
        words = re.findall(r"\b[a-z0-9_-]{2,}\b", cleaned)
        if not words:
            return [0.0] * self.dimension

        vector = [0.0] * self.dimension

        for i, word in enumerate(words):
            stemmed = self._stem(word)
            weight = 1.0
            for kw, kw_weight in LEGAL_KEYWORDS.items():
                if kw in word or kw in stemmed:
                    weight = max(weight, kw_weight)

            for target in (word, stemmed):
                for seed in range(3):
                    idx = abs(self._hash_token(target, seed)) % self.dimension
                    sign = 1.0 if self._hash_token(target, seed + 10) > 0 else -1.0
                    vector[idx] += sign * weight

            if i < len(words) - 1:
                next_stem = self._stem(words[i + 1])
                bigram = f"{stemmed}_{next_stem}"
                b_idx = abs(self._hash_token(bigram, 99)) % self.dimension
                b_sign = 1.0 if self._hash_token(bigram, 199) > 0 else -1.0
                vector[b_idx] += b_sign * 1.5

        for i in range(len(cleaned) - 3):
            quad = cleaned[i : i + 4]
            q_idx = abs(self._hash_token(quad, 333)) % self.dimension
            q_sign = 1.0 if self._hash_token(quad, 444) > 0 else -1.0
            vector[q_idx] += q_sign * 0.2

        return l2_normalize(vector)


class EmbeddingService:
    """
    Embedding client backed by Google Gemini (`gemini-embedding-001`),
    optional OpenAI (`text-embedding-3-small`), and an offline legal fallback.
    """

    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.local_vectorizer = DeterministicLegalVectorizer(dimension=dimension)
        self.model_name = os.environ.get("GEMINI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
        self._disabled_gemini_keys: set[str] = set()
        self._disabled_openai_keys: set[str] = set()
        self._genai_clients: dict[str, object] = {}
        self.last_used_neural: bool = False

    def _active_gemini_key(self) -> Optional[str]:
        key = os.environ.get("GEMINI_API_KEY")
        if not key or key.strip() in ("", "your_gemini_api_key_here"):
            return None
        if key in self._disabled_gemini_keys:
            return None
        return key

    def _active_openai_key(self) -> Optional[str]:
        key = os.environ.get("OPENAI_API_KEY")
        if not key or key.strip() in ("", "your_openai_api_key_here"):
            return None
        if key in self._disabled_openai_keys:
            return None
        return key

    def _get_genai_client(self, api_key: str):
        if api_key not in self._genai_clients:
            from google import genai

            self._genai_clients[api_key] = genai.Client(api_key=api_key)
        return self._genai_clients[api_key]

    def is_neural_provider(self) -> bool:
        return bool(self._active_gemini_key() or self._active_openai_key())

    def get_provider_name(self) -> str:
        if self._active_gemini_key():
            return f"gemini ({self.model_name} | {self.dimension}-dim)"
        if self._active_openai_key():
            return f"openai (text-embedding-3-small | {self.dimension}-dim)"
        return f"local-legal-vectorizer ({self.dimension}-dim)"

    def _embed_with_gemini(
        self,
        texts: List[str],
        task_type: str = "RETRIEVAL_DOCUMENT",
    ) -> Optional[List[List[float]]]:
        api_key = self._active_gemini_key()
        if not api_key or not texts:
            return None

        try:
            from google.genai import types

            client = self._get_genai_client(api_key)
            results: List[List[float]] = []

            # Gemini batch embed supports up to 100 items per request; keep slices at 50.
            batch_size = 50
            for start in range(0, len(texts), batch_size):
                slice_texts = [t if t and t.strip() else " " for t in texts[start : start + batch_size]]
                config = types.EmbedContentConfig(
                    output_dimensionality=self.dimension,
                    task_type=task_type,
                )
                response = client.models.embed_content(
                    model=self.model_name,
                    contents=slice_texts,
                    config=config,
                )
                embeddings = getattr(response, "embeddings", None) or []
                if len(embeddings) != len(slice_texts):
                    return None
                for item in embeddings:
                    vals = list(item.values)
                    if len(vals) != self.dimension:
                        return None
                    # Truncated gemini-embedding-001 vectors (< 3072) must be L2-normalized.
                    results.append(l2_normalize(vals))

            return results
        except Exception as exc:
            err_msg = str(exc).lower()
            if any(tok in err_msg for tok in ("api key", "401", "403", "404", "not found", "permission")):
                self._disabled_gemini_keys.add(api_key)
            return None

    def _embed_with_openai(self, texts: List[str]) -> Optional[List[List[float]]]:
        api_key = self._active_openai_key()
        if not api_key or not texts:
            return None

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "input": [t if t else " " for t in texts],
                        "model": "text-embedding-3-small",
                        "dimensions": self.dimension,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json().get("data", [])
                    if len(data) == len(texts):
                        return [l2_normalize(item["embedding"]) for item in data]
                if resp.status_code in (401, 403):
                    self._disabled_openai_keys.add(api_key)
        except Exception:
            pass
        return None

    def embed_text(self, text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> List[float]:
        """Generate a normalized embedding vector for a single string."""
        if not text or not text.strip():
            return [0.0] * self.dimension

        vectors = self.embed_batch([text], task_type=task_type)
        return vectors[0] if vectors else [0.0] * self.dimension

    def embed_query(self, query: str) -> List[float]:
        """Embed a user search query using asymmetric RETRIEVAL_QUERY task optimization."""
        return self.embed_text(query, task_type="RETRIEVAL_QUERY")

    def embed_batch(
        self,
        texts: List[str],
        task_type: str = "RETRIEVAL_DOCUMENT",
    ) -> List[List[float]]:
        """Embed a batch of strings with neural batching and offline fallback."""
        if not texts:
            return []

        empty_mask = [not (t and t.strip()) for t in texts]
        non_empty_indices = [i for i, is_empty in enumerate(empty_mask) if not is_empty]
        if not non_empty_indices:
            return [[0.0] * self.dimension for _ in texts]

        non_empty_texts = [texts[i] for i in non_empty_indices]

        vectors = self._embed_with_gemini(non_empty_texts, task_type=task_type)
        used_neural = vectors is not None
        if vectors is None:
            vectors = self._embed_with_openai(non_empty_texts)
            used_neural = vectors is not None
        if vectors is None:
            vectors = [self.local_vectorizer.vectorize(t) for t in non_empty_texts]
            used_neural = False
        self.last_used_neural = used_neural

        output: List[List[float]] = [[0.0] * self.dimension for _ in texts]
        for idx, vec in zip(non_empty_indices, vectors):
            output[idx] = vec
        return output

    def embed_chunks(self, chunks: List[DocumentChunk]) -> List[DocumentChunk]:
        """Batch-embed document chunks with clause-type and section-heading context."""
        if not chunks:
            return chunks

        inputs: List[str] = []
        for chunk in chunks:
            heading = chunk.section_heading or ""
            ctype = getattr(chunk, "clause_type", None) or ""
            if ctype and heading:
                prefix = f"[{ctype} | {heading}] "
            elif ctype or heading:
                prefix = f"[{ctype or heading}] "
            else:
                prefix = ""
            inputs.append(f"{prefix}{chunk.text}")

        vectors = self.embed_batch(inputs, task_type="RETRIEVAL_DOCUMENT")
        for chunk, vec in zip(chunks, vectors):
            chunk.embedding = vec
            chunk.embedding_dim = len(vec)

        return chunks

    @staticmethod
    def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
        """Compute cosine similarity between two equal-length vectors."""
        if not vec_a or not vec_b or len(vec_a) != len(vec_b):
            return 0.0

        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))

        if norm_a < 1e-9 or norm_b < 1e-9:
            return 0.0

        return round(dot / (norm_a * norm_b), 4)


embedding_service = EmbeddingService()
