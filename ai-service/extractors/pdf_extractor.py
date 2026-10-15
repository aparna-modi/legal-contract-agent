import io
from typing import Any, Dict, List, Optional
import pypdf

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.utils import clean_text, count_tokens, is_heading


class PDFDocumentExtractor(BaseDocumentExtractor):
    """
    Extracts text from PDF documents with accurate page-number tracking,
    layout preservation, and legal section heading detection.
    """

    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        stream = io.BytesIO(content)
        try:
            reader = pypdf.PdfReader(stream)
        except Exception as e:
            raise ValueError(f"Failed to parse PDF document '{filename}': {str(e)}")

        total_pages = len(reader.pages)
        chunks: List[DocumentChunk] = []
        full_text_parts: List[str] = []
        current_char_offset = 0
        chunk_id = 1
        current_section: Optional[str] = None
        unique_sections = set()

        for page_idx, page in enumerate(reader.pages):
            page_number = page_idx + 1
            try:
                page_text = page.extract_text() or ""
            except Exception:
                page_text = ""

            page_text = clean_text(page_text)
            if not page_text:
                continue

            # Split page text into candidate blocks (double line breaks or individual lines)
            raw_blocks = page_text.split("\n\n")

            for block in raw_blocks:
                block = block.strip()
                if not block:
                    continue

                # Check if block is or contains a section heading
                lines = [l.strip() for l in block.split("\n") if l.strip()]
                first_line = lines[0] if lines else ""

                if is_heading(first_line):
                    current_section = first_line
                    unique_sections.add(current_section)
                    chunk_type = "heading" if len(lines) == 1 else "clause"
                else:
                    chunk_type = "paragraph"

                # Append to full text
                if full_text_parts:
                    full_text_parts.append("\n\n")
                    current_char_offset += 2

                start_char = current_char_offset
                full_text_parts.append(block)
                current_char_offset += len(block)
                end_char = current_char_offset

                tokens = count_tokens(block)

                chunk = DocumentChunk(
                    chunk_id=chunk_id,
                    text=block,
                    page_number=page_number,
                    section_heading=current_section,
                    start_char=start_char,
                    end_char=end_char,
                    token_count=tokens,
                    chunk_type=chunk_type,
                    metadata={
                        "page_number": page_number,
                        "line_count": len(lines),
                        "is_heading": is_heading(first_line),
                    },
                )
                chunks.append(chunk)
                chunk_id += 1

        full_text = "".join(full_text_parts)
        words = len(full_text.split())
        total_tokens = count_tokens(full_text)

        metadata: Dict[str, Any] = {
            "total_pages": total_pages,
            "has_text": len(full_text) > 0,
            "detected_sections_count": len(unique_sections),
        }

        # PDF metadata (author, title, creation date if present)
        if reader.metadata:
            try:
                for k, v in reader.metadata.items():
                    clean_k = k.lstrip("/")
                    if isinstance(v, (str, int, float, bool)):
                        metadata[clean_k] = v
            except Exception:
                pass

        return ExtractionResult(
            document_name=filename,
            file_type="pdf",
            total_pages=total_pages,
            total_sections=len(unique_sections),
            total_characters=len(full_text),
            total_words=words,
            total_tokens=total_tokens,
            full_text=full_text,
            chunks=chunks,
            metadata=metadata,
        )
