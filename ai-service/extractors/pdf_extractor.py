import io
import re
from collections import Counter
from typing import Any, Dict, List, Optional

import pypdf

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.utils import clean_text, count_tokens, extract_clause_number, is_heading
from services.llm_client import llm_client

_PAGE_MARKER_RE = re.compile(r"^(?:page\s+\d+(?:\s+of\s+\d+)?|[-–—\s]*\d+[-–—\s]*)$", re.IGNORECASE)
_SIGNATURE_LINE_RE = re.compile(r"^[_=\-]{4,}$")
_MAX_CHUNK_TOKENS = 520
_MAJOR_SECTION_RE = re.compile(
    r"^(?:(?:SECTION|ARTICLE|CLAUSE|SCHEDULE|ANNEXURE|EXHIBIT|PART)\s+[A-Z0-9IVX]+(?:[.\-:\s]+[^\n]{0,80})?|"
    r"\d{1,2}\.\s+[A-Z][A-Z0-9\s,&/\-()]{2,72})(?:\s*$|\s*[:.\-–—]\s*)",
    re.IGNORECASE,
)


def _extract_major_section_title(line: str, clause_num: Optional[str], line_is_heading: bool) -> Optional[str]:
    """Return a clean section heading whenever a line introduces a major section, article, or schedule."""
    stripped = (line or "").strip()
    if not stripped:
        return None
    if re.match(r"^(?:SECTION|ARTICLE|SCHEDULE|ANNEXURE|EXHIBIT|PART)\s+[A-Z0-9IVX]+", stripped, re.I):
        head = stripped.split("\n", 1)[0].strip()
        # Trim inline body text if a period + lowercase sentence follows an uppercase title
        m_inline = re.match(r"^((?:SECTION|ARTICLE|SCHEDULE|ANNEXURE|EXHIBIT|PART)\s+[A-Z0-9IVX]+[^.\n]{0,75}?)\.\s+[A-Z][a-z]", head)
        return (m_inline.group(1) if m_inline else head)[:95].rstrip(" :-.")
    if clause_num and "." not in clause_num:
        m_num = re.match(r"^(\d{1,2}\.\s+[A-Z][A-Z0-9\s,&/\-()]{2,70}?)(?:\.\s+[A-Z][a-z]|$)", stripped)
        if m_num:
            return m_num.group(1).strip().rstrip(" :-.")
        if line_is_heading and len(stripped) <= 90:
            return stripped.rstrip(" :-.")
    if line_is_heading and not clause_num and len(stripped) <= 90:
        return stripped.rstrip(" :-.")
    return None


class PDFDocumentExtractor(BaseDocumentExtractor):
    """Extracts PDF text page-by-page with section/clause splitting and Gemini OCR fallback."""

    @staticmethod
    def _find_repeating_headers_footers(page_texts: List[str]) -> set[str]:
        """Identify short running headers or footers repeated across multiple pages."""
        if len(page_texts) < 2:
            return set()

        edge_counts: Counter[str] = Counter()
        for raw_page in page_texts:
            lines = [ln.strip() for ln in clean_text(raw_page or "").splitlines() if ln.strip()]
            if not lines:
                continue
            candidates = set()
            for edge_line in lines[:2] + lines[-2:]:
                if 3 <= len(edge_line) <= 90 and not _PAGE_MARKER_RE.match(edge_line):
                    candidates.add(edge_line.lower())
            for item in candidates:
                edge_counts[item] += 1

        threshold = max(2, len(page_texts) // 2)
        return {line for line, count in edge_counts.items() if count >= threshold}

    @staticmethod
    def _split_oversized_block(text: str, max_tokens: int = _MAX_CHUNK_TOKENS) -> List[str]:
        """Break very large uninterrupted blocks along sentence boundaries."""
        if count_tokens(text) <= max_tokens:
            return [text]

        sentences = re.split(r"(?<=[.;!?])\s+(?=[A-Z0-9(\[])", text)
        parts: List[str] = []
        current: List[str] = []
        current_tokens = 0

        for sentence in sentences:
            s_tokens = count_tokens(sentence)
            if current and current_tokens + s_tokens > max_tokens:
                parts.append(" ".join(current).strip())
                current = [sentence]
                current_tokens = s_tokens
            else:
                current.append(sentence)
                current_tokens += s_tokens

        if current:
            parts.append(" ".join(current).strip())
        return [p for p in parts if p]

    def _split_page_into_blocks(
        self,
        page_text: str,
        repeating_edges: set[str],
        inherited_section: Optional[str],
    ) -> tuple[List[Dict[str, Any]], Optional[str]]:
        """
        Split a single PDF page into clean clause blocks while tracking the active
        section heading and numbered sub-clauses (e.g. 1.1, 2.2, 9.1).
        """
        if "\n\n" in page_text:
            raw_blocks = [b.strip() for b in page_text.split("\n\n") if b.strip()]
            if len(raw_blocks) > 1:
                blocks: List[Dict[str, Any]] = []
                active_section = inherited_section
                for blk in raw_blocks:
                    cleaned_lines = [
                        ln.strip()
                        for ln in blk.splitlines()
                        if ln.strip()
                        and not _PAGE_MARKER_RE.match(ln.strip())
                        and ln.strip().lower() not in repeating_edges
                    ]
                    if not cleaned_lines:
                        continue
                    text = "\n".join(cleaned_lines)
                    first_line = cleaned_lines[0]
                    clause_num = extract_clause_number(first_line)
                    line_is_head = is_heading(first_line)
                    detected_head = _extract_major_section_title(first_line, clause_num, line_is_head)
                    if detected_head:
                        active_section = detected_head
                    else:
                        # Also scan early lines inside a merged block for explicit SECTION/SCHEDULE headers.
                        for inner in cleaned_lines[1:3]:
                            inner_head = _extract_major_section_title(inner, extract_clause_number(inner), is_heading(inner))
                            if inner_head and re.match(r"^(?:SECTION|ARTICLE|SCHEDULE|ANNEXURE|\d{1,2}\.\s+[A-Z]{3,})", inner_head, re.I):
                                active_section = inner_head
                                detected_head = inner_head
                                break
                    blocks.append({
                        "text": text,
                        "heading": active_section,
                        "detected_heading": detected_head,
                        "clause_number": clause_num or "",
                    })
                return blocks, active_section

        raw_lines = [ln.strip() for ln in page_text.splitlines()]
        lines = [
            ln for ln in raw_lines
            if ln and not _PAGE_MARKER_RE.match(ln) and ln.lower() not in repeating_edges
        ]
        if not lines:
            return [], inherited_section

        blocks = []
        active_section = inherited_section
        pending_heading: Optional[str] = None
        cur_lines: List[str] = []
        cur_clause_num = ""

        def flush() -> None:
            nonlocal cur_lines, cur_clause_num, pending_heading
            if not cur_lines:
                return
            joined = "\n".join(cur_lines).strip()
            if joined:
                for piece in self._split_oversized_block(joined):
                    blocks.append({
                        "text": piece,
                        "heading": active_section,
                        "detected_heading": pending_heading,
                        "clause_number": cur_clause_num,
                    })
            cur_lines = []
            cur_clause_num = ""
            pending_heading = None

        for idx, line in enumerate(lines):
            clause_num = extract_clause_number(line)
            line_is_heading = is_heading(line)

            # Merge wrapped ALL-CAPS title continuation (e.g. "...APARTMENT" + "PROPERTY").
            if (
                line_is_heading
                and not clause_num
                and not cur_lines
                and blocks
                and blocks[-1].get("is_standalone_heading")
                and line == line.upper()
                and blocks[-1]["text"] == blocks[-1]["text"].upper()
                and len(line.split()) <= 3
                and not re.match(r"^(?:BETWEEN|WHEREAS|SCHEDULE|ARTICLE|SECTION|CLAUSE|VENDOR|PURCHASER|WITNESSES)\b", line, re.I)
            ):
                merged = f"{blocks[-1]['text']} {line}"
                blocks[-1]["text"] = merged
                blocks[-1]["heading"] = merged
                blocks[-1]["detected_heading"] = merged
                active_section = merged
                continue

            # A numbered major section or sub-clause starts a fresh clause block.
            if clause_num:
                flush()
                major_title = _extract_major_section_title(line, clause_num, line_is_heading)
                if major_title:
                    active_section = major_title
                    pending_heading = major_title
                elif line_is_heading:
                    # Short sub-heading such as "9.1 Default by Purchaser:"
                    pending_heading = line
                cur_clause_num = clause_num
                cur_lines = [line]
                continue

            if line_is_heading or _MAJOR_SECTION_RE.match(line):
                flush()
                clean_title = _extract_major_section_title(line, None, True) or line
                active_section = clean_title
                pending_heading = clean_title
                # If the very next line is also a heading or a numbered sub-clause,
                # emit this standalone section title as a heading chunk only when needed
                # or let it stay attached to the following paragraph.
                next_line = lines[idx + 1] if idx + 1 < len(lines) else ""
                if not next_line or extract_clause_number(next_line) or is_heading(next_line):
                    # Preserve standalone section title so headings and section counts stay accurate.
                    blocks.append({
                        "text": line,
                        "heading": active_section,
                        "detected_heading": line,
                        "clause_number": "",
                        "is_standalone_heading": True,
                    })
                    pending_heading = None
                else:
                    cur_lines = [line]
                continue

            if _SIGNATURE_LINE_RE.match(line) and cur_lines:
                cur_lines.append(line)
                continue

            cur_lines.append(line)

        flush()
        return blocks, active_section

    def _chunks_from_page_texts(self, page_texts: List[str]) -> tuple[List[DocumentChunk], str, set[str]]:
        chunks: List[DocumentChunk] = []
        full_parts: List[str] = []
        offset = 0
        chunk_id = 1
        current_section: Optional[str] = None
        unique_sections: set[str] = set()
        repeating_edges = self._find_repeating_headers_footers(page_texts)

        for page_idx, raw_page in enumerate(page_texts):
            page_number = page_idx + 1
            page_text = clean_text(raw_page or "")
            if not page_text:
                continue

            page_blocks, current_section = self._split_page_into_blocks(
                page_text, repeating_edges, current_section
            )
            for item in page_blocks:
                block = item["text"]
                if not block:
                    continue

                lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
                first_line = lines[0] if lines else ""
                heading = item.get("heading") or current_section
                detected_heading = item.get("detected_heading")
                clause_number = item.get("clause_number") or ""

                if detected_heading:
                    unique_sections.add(detected_heading)

                if item.get("is_standalone_heading"):
                    chunk_type = "heading"
                elif clause_number:
                    chunk_type = "clause"
                elif detected_heading:
                    chunk_type = "heading" if len(lines) == 1 else "clause"
                elif page_number == 1 and not heading:
                    heading = "Preamble & Parties"
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
                        section_heading=heading or "General",
                        start_char=start_char,
                        end_char=offset,
                        token_count=count_tokens(block),
                        chunk_type=chunk_type,
                        metadata={
                            "page_number": page_number,
                            "line_count": len(lines),
                            "clause_number": clause_number,
                            "is_heading": bool(item.get("is_standalone_heading") or (detected_heading and len(lines) == 1)),
                        },
                    )
                )
                chunk_id += 1

        return chunks, "".join(full_parts), unique_sections

    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
        except Exception as exc:
            raise ValueError(f"Failed to parse PDF document '{filename}': {exc}")

        total_pages = len(reader.pages)
        page_texts: List[str] = []
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
                for key, val in reader.metadata.items():
                    if isinstance(val, (str, int, float, bool)):
                        metadata[key.lstrip("/")] = val
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
