import re
from typing import Any, Dict, List, Optional

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.utils import clean_text, count_tokens, is_heading


class TXTDocumentExtractor(BaseDocumentExtractor):
    """
    Extracts text from plain text files, preserving structural indentation,
    detecting legal clause hierarchies (1.1, (a), (i)), and section headings.
    """

    SUBCLAUSE_PATTERN = re.compile(
        r"^\s*(?:(?:\([a-zA-Z0-9]+\))|(?:[a-zA-Z0-9]+\.)|(?:[ivxlcdm]+\.))\s+",
        re.IGNORECASE,
    )

    def _decode_bytes(self, content: bytes) -> str:
        """Decode text content trying common encodings."""
        for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
            try:
                return content.decode(encoding)
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="replace")

    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        raw_text = self._decode_bytes(content)
        raw_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")

        lines = raw_text.split("\n")
        chunks: List[DocumentChunk] = []
        full_text_parts: List[str] = []
        current_char_offset = 0
        chunk_id = 1
        current_section: Optional[str] = None
        unique_sections = set()

        current_block_lines: List[str] = []

        def flush_block():
            nonlocal chunk_id, current_char_offset, current_section
            if not current_block_lines:
                return

            # Measure indentation of first non-empty line
            first_raw_line = current_block_lines[0]
            indent_match = re.match(r"^([ \t]+)", first_raw_line)
            indent_spaces = (
                len(indent_match.group(1).replace("\t", "    ")) if indent_match else 0
            )

            # Clean and consolidate block text while preserving relative indentation
            block_text = "\n".join(current_block_lines).rstrip()
            current_block_lines.clear()

            stripped_text = block_text.strip()
            if not stripped_text:
                return

            first_line_stripped = stripped_text.split("\n")[0].strip()

            # Determine chunk type
            is_head = is_heading(first_line_stripped)
            is_sub = bool(self.SUBCLAUSE_PATTERN.match(first_line_stripped))

            if is_head:
                current_section = first_line_stripped
                unique_sections.add(current_section)
                chunk_type = "heading" if len(stripped_text.split("\n")) == 1 else "clause"
            elif is_sub:
                chunk_type = "clause"
            elif first_line_stripped.startswith(("-", "*", "•")):
                chunk_type = "list_item"
            else:
                chunk_type = "paragraph"

            if full_text_parts:
                full_text_parts.append("\n\n")
                current_char_offset += 2

            start_char = current_char_offset
            full_text_parts.append(block_text)
            current_char_offset += len(block_text)
            end_char = current_char_offset

            tokens = count_tokens(block_text)

            chunk = DocumentChunk(
                chunk_id=chunk_id,
                text=block_text,
                page_number=None,
                section_heading=current_section,
                start_char=start_char,
                end_char=end_char,
                token_count=tokens,
                chunk_type=chunk_type,
                metadata={
                    "indent_spaces": indent_spaces,
                    "is_heading": is_head,
                    "is_subclause": is_sub,
                },
            )
            chunks.append(chunk)
            chunk_id += 1

        prev_indent = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush_block()
                prev_indent = None
                continue

            # Calculate line indentation
            indent_match = re.match(r"^([ \t]+)", line)
            line_indent = (
                len(indent_match.group(1).replace("\t", "    ")) if indent_match else 0
            )

            is_sub = bool(self.SUBCLAUSE_PATTERN.match(stripped))
            is_head = is_heading(stripped)

            # Flush previous block if this line is a heading, a new subclause, or has different indentation
            if current_block_lines and (
                is_head
                or is_sub
                or (prev_indent is not None and line_indent != prev_indent)
            ):
                flush_block()

            current_block_lines.append(line)
            prev_indent = line_indent

        flush_block()

        full_text = "".join(full_text_parts)
        words = len(full_text.split())
        total_tokens = count_tokens(full_text)

        metadata: Dict[str, Any] = {
            "total_lines": len(lines),
            "detected_sections_count": len(unique_sections),
        }

        return ExtractionResult(
            document_name=filename,
            file_type="txt",
            total_pages=None,
            total_sections=len(unique_sections),
            total_characters=len(full_text),
            total_words=words,
            total_tokens=total_tokens,
            full_text=full_text,
            chunks=chunks,
            metadata=metadata,
        )
