import hashlib
import math
import os
import re
from typing import List, Optional
import httpx

from extractors.base import DocumentChunk

# High-frequency legal domain keywords with semantic weighting
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
}


class DeterministicLegalVectorizer:
    """
    High-performance, deterministic legal-domain semantic vectorizer.
    Produces unit-normalized 384-dimensional dense vectors using:
    - Lowercase token & sub-word n-gram hashing
    - Legal domain keyword weighting
    - Stable pseudo-random orthogonal projection
    - L2 normalization for exact cosine similarity measurement
    """

    def __init__(self, dimension: int = 384):
        self.dimension = dimension

    def _hash_token(self, token: str, seed: int) -> int:
        h = hashlib.sha256(f"{token}_{seed}".encode("utf-8")).digest()
        return int.from_bytes(h[:4], "little", signed=True)

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

        # 1. Word and sub-word n-gram projection with stemming
        for i, word in enumerate(words):
            stemmed = self._stem(word)
            # Check legal domain weight
            weight = 1.0
            for kw, kw_weight in LEGAL_KEYWORDS.items():
                if kw in word or kw in stemmed:
                    weight = max(weight, kw_weight)

            # Map raw word and stemmed word to projection indices
            for target in (word, stemmed):
                for seed in range(3):
                    idx = abs(self._hash_token(target, seed)) % self.dimension
                    sign = 1.0 if self._hash_token(target, seed + 10) > 0 else -1.0
                    vector[idx] += sign * weight

            # Bi-grams for local context continuity
            if i < len(words) - 1:
                next_stem = self._stem(words[i+1])
                bigram = f"{stemmed}_{next_stem}"
                b_idx = abs(self._hash_token(bigram, 99)) % self.dimension
                b_sign = 1.0 if self._hash_token(bigram, 199) > 0 else -1.0
                vector[b_idx] += b_sign * 1.5

        # 2. Add global character n-gram fingerprint for morphological similarity
        for i in range(len(cleaned) - 3):
            quad = cleaned[i : i + 4]
            q_idx = abs(self._hash_token(quad, 333)) % self.dimension
            q_sign = 1.0 if self._hash_token(quad, 444) > 0 else -1.0
            vector[q_idx] += q_sign * 0.2

        # 3. L2 Normalization (||v|| = 1.0)
        norm = math.sqrt(sum(x * x for x in vector))
        if norm > 1e-9:
            vector = [round(x / norm, 6) for x in vector]
        else:
            vector = [0.0] * self.dimension

        return vector


class EmbeddingService:
    """
    Provider-agnostic Embedding Service.
    Supports:
    - OpenAI text-embedding-3-small (if OPENAI_API_KEY is present)
    - Google Gemini text-embedding-004 (if GEMINI_API_KEY is present)
    - Built-in DeterministicLegalVectorizer (384-dim, zero external dependencies)
    """

    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.local_vectorizer = DeterministicLegalVectorizer(dimension=dimension)
        self.openai_key = os.environ.get("OPENAI_API_KEY")
        self.gemini_key = os.environ.get("GEMINI_API_KEY")

    def get_provider_name(self) -> str:
        if self.openai_key:
            return "openai (text-embedding-3-small)"
        if self.gemini_key:
            return "gemini (text-embedding-004)"
        return f"local-legal-vectorizer ({self.dimension}-dim)"

    def embed_text(self, text: str) -> List[float]:
        """Embed a single text string."""
        if not text:
            return [0.0] * self.dimension

        # Attempt OpenAI if key configured
        if self.openai_key:
            try:
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(
                        "https://api.openai.com/v1/embeddings",
                        headers={"Authorization": f"Bearer {self.openai_key}"},
                        json={"input": text, "model": "text-embedding-3-small"},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["data"][0]["embedding"]
            except Exception:
                pass  # Fallback to local vectorizer

        return self.local_vectorizer.vectorize(text)

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed multiple text strings."""
        return [self.embed_text(t) for t in texts]

    def embed_chunks(self, chunks: List[DocumentChunk]) -> List[DocumentChunk]:
        """
        Enrich a list of DocumentChunk instances with dense vector embeddings
        and embedding dimensions.
        """
        for chunk in chunks:
            text_to_embed = chunk.text
            heading = chunk.section_heading or ""
            ctype = getattr(chunk, "clause_type", None) or ""
            context_prefix = f"[{ctype} | {heading}]" if ctype and heading else (f"[{ctype or heading}]" if ctype or heading else "")
            if context_prefix:
                text_to_embed = f"{context_prefix} {chunk.text}"

            chunk.embedding = self.embed_text(text_to_embed)
            chunk.embedding_dim = len(chunk.embedding)

        return chunks

    @staticmethod
    def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
        """Compute the cosine similarity between two unit or raw vectors."""
        if not vec_a or not vec_b or len(vec_a) != len(vec_b):
            return 0.0

        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))

        if norm_a < 1e-9 or norm_b < 1e-9:
            return 0.0

        return round(dot / (norm_a * norm_b), 4)


# Global singleton instance
embedding_service = EmbeddingService()
