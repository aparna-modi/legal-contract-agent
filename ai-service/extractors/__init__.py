import os
from typing import Dict, Type

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.docx_extractor import DOCXDocumentExtractor
from extractors.pdf_extractor import PDFDocumentExtractor
from extractors.txt_extractor import TXTDocumentExtractor

EXTRACTOR_REGISTRY: Dict[str, Type[BaseDocumentExtractor]] = {
    "pdf": PDFDocumentExtractor,
    "docx": DOCXDocumentExtractor,
    "txt": TXTDocumentExtractor,
}


def get_extractor(filename_or_ext: str) -> BaseDocumentExtractor:
    """
    Factory to return the appropriate document extractor based on filename or extension.
    """
    clean_ext = filename_or_ext.lower().strip()
    if clean_ext.startswith("."):
        clean_ext = clean_ext.lstrip(".")
    elif "." in clean_ext:
        clean_ext = os.path.splitext(clean_ext)[1].lstrip(".")

    extractor_cls = EXTRACTOR_REGISTRY.get(clean_ext)
    if not extractor_cls:
        supported = ", ".join(f".{k}" for k in EXTRACTOR_REGISTRY.keys())
        raise ValueError(
            f"Unsupported file extension '{clean_ext}'. Supported formats are: {supported}"
        )
    return extractor_cls()


__all__ = [
    "BaseDocumentExtractor",
    "DocumentChunk",
    "ExtractionResult",
    "PDFDocumentExtractor",
    "DOCXDocumentExtractor",
    "TXTDocumentExtractor",
    "get_extractor",
    "EXTRACTOR_REGISTRY",
]
