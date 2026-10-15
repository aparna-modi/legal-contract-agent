from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DocumentChunk(BaseModel):
    chunk_id: int
    text: str
    page_number: Optional[int] = None
    section_heading: Optional[str] = None
    start_char: int
    end_char: int
    token_count: int
    chunk_type: str = "paragraph"  # "heading", "paragraph", "table", "clause", "list_item"
    embedding: Optional[List[float]] = None
    embedding_dim: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ExtractionResult(BaseModel):
    document_name: str
    file_type: str
    total_pages: Optional[int] = None
    total_sections: int = 0
    total_characters: int = 0
    total_words: int = 0
    total_tokens: int = 0
    full_text: str
    chunks: List[DocumentChunk] = Field(default_factory=list)
    has_embeddings: bool = False
    embedding_model: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BaseDocumentExtractor(ABC):
    @abstractmethod
    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        """Extract structured content and chunks from raw file bytes."""
        pass

    def extract_from_path(self, file_path: str) -> ExtractionResult:
        """Extract structured content and chunks from a local file path."""
        import os
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            content = f.read()
        return self.extract_from_bytes(content, filename)
