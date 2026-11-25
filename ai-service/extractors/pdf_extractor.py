import io
import re
from typing import Any, Dict, List, Optional
import pypdf

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.utils import clean_text, count_tokens, is_heading
from services.llm_client import llm_client

_PAGE_HEADER_RE = re.compile(r"^(?:page\s+\d+(?:\s+of\s+\d+)?|[-–—\s]*\d+[-–—\s]*)$", re.IGNORECASE)


class PDFDocumentExtractor(BaseDocumentExtractor):
    """Extracts PDF text with per-page section/clause splitting and Gemini OCR fallback."""

    def _split_page_into_sections(self, page_text: str) -> List[tuple[Optional[str], str]]:
        """Split a page into logical sections/clauses even when pypdf emits single newlines."""
        if "\n\n" in page_text:
            raw_blocks = [b.strip() for b in page_text.split("\n\n") if b.strip()]
            if len(raw_blocks) > 1:
                out: List[tuple[Optional[str], str]] = []
                for blk in raw_blocks:
                    first = blk.split("\n", 1)[0].strip()
                    out.append((first if is_heading(first) else None, blk))
                return out

        lines = [ln.rstrip() for ln in page_text.splitlines()]
        sections: List[tuple[Optional[str], List[str]]] = []
        cur_heading: Optional[str] = None
        cur_lines: List[str] = []

        for raw_line in lines:
            stripped = raw_line.strip()
            if not stripped or _PAGE_HEADER_RE.match(stripped):
                continue

            if is_heading(stripped):
                if cur_lines:
                    sections.append((cur_heading, cur_lines))
                cur_heading = stripped
                cur_lines = [stripped]
            else:
                cur_lines.append(stripped)

        if cur_lines:
            sections.append((cur_heading, cur_lines))

        return [(h, "\n".join(ls).strip()) for h, ls in sections if ls]

    def _chunks_from_page_texts(self, page_texts: List[str]) -> tuple[List[DocumentChunk], str, set[str]]:
        chunks: List[DocumentChunk] = []
        full_parts: List[str] = []
        offset = 0
        chunk_id = 1
        current_section: Optional[str] = None
        unique_sections: set[str] = set()

        for page_idx, raw_page in enumerate(page_texts):
            page_number = page_idx + 1
            page_text = clean_text(raw_page or "")
            if not page_text:
                continue

            for detected_heading, block in self._split_page_into_sections(page_text):
                if not block:
                    continue
                lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
                first_line = lines[0] if lines else ""

                if detected_heading:
                    current_section = detected_heading
                    unique_sections.add(current_section)
                    chunk_type = "heading" if len(lines) == 1 else "clause"
                elif page_number == 1 and not current_section:
                    current_section = "Preamble & Parties"
                    chunk_type = "clause"
                else:
                    chunk_type = "paragraph"

                if full_parts:
                    full_parts.append("\n\n")
                    offset += 2

                start_char = offset
                full_parts.append(block)
                offset += len(block)

                chunks.append(
                    DocumentChunk(
                        chunk_id=chunk_id,
                        text=block,
                        page_number=page_number,
                        section_heading=current_section,
                        start_char=start_char,
                        end_char=offset,
                        token_count=count_tokens(block),
                        chunk_type=chunk_type,
                        metadata={
                            "page_number": page_number,
                            "line_count": len(lines),
                            "is_heading": bool(detected_heading or is_heading(first_line)),
                        },
                    )
                )
                chunk_id += 1

        return chunks, "".join(full_parts), unique_sections

    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
        except Exception as e:
            raise ValueError(f"Failed to parse PDF document '{filename}': {str(e)}")

        total_pages = len(reader.pages)
        page_texts = []
        for page in reader.pages:
            try:
                page_texts.append(page.extract_text() or "")
            except Exception:
                page_texts.append("")

        chunks, full_text, unique_sections = self._chunks_from_page_texts(page_texts)

        ocr_used = False
        ocr_attempted = False
        if total_pages > 0 and len(full_text.strip()) < 40:
            ocr_attempted = True
            ocr_pages = llm_client.ocr_pdf_bytes(content)
            if ocr_pages:
                ocr_used = True
                chunks, full_text, unique_sections = self._chunks_from_page_texts(ocr_pages)

        metadata: Dict[str, Any] = {
            "total_pages": total_pages,
            "has_text": len(full_text) > 0,
            "detected_sections_count": len(unique_sections),
            "ocr_used": ocr_used,
            "ocr_attempted": ocr_attempted,
        }
        if reader.metadata:
            try:
                for k, v in reader.metadata.items():
                    if isinstance(v, (str, int, float, bool)):
                        metadata[k.lstrip("/")] = v
            except Exception:
                pass

        return ExtractionResult(
            document_name=filename,
            file_type="pdf",
            total_pages=total_pages,
            total_sections=len(unique_sections),
            total_characters=len(full_text),
            total_words=len(full_text.split()),
            total_tokens=count_tokens(full_text),
            full_text=full_text,
            chunks=chunks,
            metadata=metadata,
        )
