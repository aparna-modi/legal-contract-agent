import io
from typing import Any, Dict, List, Optional
import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

from extractors.base import BaseDocumentExtractor, DocumentChunk, ExtractionResult
from extractors.utils import clean_text, count_tokens, is_heading


class DOCXDocumentExtractor(BaseDocumentExtractor):
    """
    Extracts text from DOCX documents preserving paragraph hierarchy,
    heading styles, embedded tables, and character offsets.
    """

    def _format_table(self, table: Table) -> str:
        """Convert a docx table into clean Markdown tabular format."""
        rows_data = []
        for row in table.rows:
            row_cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
            # Avoid duplicate repeated cells from merged cells if row is identical
            rows_data.append(row_cells)

        if not rows_data:
            return ""

        # Remove completely empty rows
        cleaned_rows = [r for r in rows_data if any(cell.strip() for cell in r)]
        if not cleaned_rows:
            return ""

        col_count = max(len(r) for r in cleaned_rows)
        # Pad shorter rows
        padded = [r + [""] * (col_count - len(r)) for r in cleaned_rows]

        header = "| " + " | ".join(padded[0]) + " |"
        separator = "| " + " | ".join(["---"] * col_count) + " |"
        body = ["| " + " | ".join(row) + " |" for row in padded[1:]]

        return "\n".join([header, separator] + body)

    def extract_from_bytes(self, content: bytes, filename: str) -> ExtractionResult:
        stream = io.BytesIO(content)
        try:
            doc = docx.Document(stream)
        except Exception as e:
            raise ValueError(f"Failed to parse DOCX document '{filename}': {str(e)}")

        chunks: List[DocumentChunk] = []
        full_text_parts: List[str] = []
        current_char_offset = 0
        chunk_id = 1
        current_section: Optional[str] = None
        unique_sections = set()
        table_count = 0

        # Traverse body elements in document order
        for element in doc.element.body:
            tag = element.tag.lower()
            if tag.endswith("p"):
                # Paragraph
                p = Paragraph(element, doc)
                text = clean_text(p.text)
                if not text:
                    continue

                style_name = p.style.name if p.style else "Normal"
                is_styled_heading = "heading" in style_name.lower() or "title" in style_name.lower()
                is_detected_heading = is_heading(text)

                if is_styled_heading or is_detected_heading:
                    current_section = text
                    unique_sections.add(current_section)
                    chunk_type = "heading"
                elif "list" in style_name.lower() or text.startswith(("-", "*", "•")):
                    chunk_type = "list_item"
                elif is_heading(text.split("\n")[0]):
                    current_section = text.split("\n")[0]
                    unique_sections.add(current_section)
                    chunk_type = "clause"
                else:
                    chunk_type = "paragraph"

                if full_text_parts:
                    full_text_parts.append("\n\n")
                    current_char_offset += 2

                start_char = current_char_offset
                full_text_parts.append(text)
                current_char_offset += len(text)
                end_char = current_char_offset

                tokens = count_tokens(text)

                chunk = DocumentChunk(
                    chunk_id=chunk_id,
                    text=text,
                    page_number=None,
                    section_heading=current_section,
                    start_char=start_char,
                    end_char=end_char,
                    token_count=tokens,
                    chunk_type=chunk_type,
                    metadata={
                        "style": style_name,
                        "is_heading": is_styled_heading or is_detected_heading,
                    },
                )
                chunks.append(chunk)
                chunk_id += 1

            elif tag.endswith("tbl"):
                # Table
                tbl = Table(element, doc)
                table_count += 1
                formatted_table = self._format_table(tbl)
                if not formatted_table:
                    continue

                if full_text_parts:
                    full_text_parts.append("\n\n")
                    current_char_offset += 2

                start_char = current_char_offset
                full_text_parts.append(formatted_table)
                current_char_offset += len(formatted_table)
                end_char = current_char_offset

                tokens = count_tokens(formatted_table)

                chunk = DocumentChunk(
                    chunk_id=chunk_id,
                    text=formatted_table,
                    page_number=None,
                    section_heading=current_section,
                    start_char=start_char,
                    end_char=end_char,
                    token_count=tokens,
                    chunk_type="table",
                    metadata={
                        "rows": len(tbl.rows),
                        "columns": len(tbl.columns) if tbl.rows else 0,
                        "table_index": table_count,
                    },
                )
                chunks.append(chunk)
                chunk_id += 1

        full_text = "".join(full_text_parts)
        words = len(full_text.split())
        total_tokens = count_tokens(full_text)

        metadata: Dict[str, Any] = {
            "table_count": table_count,
            "detected_sections_count": len(unique_sections),
        }

        # Core properties (author, title, revision, etc.)
        try:
            core_props = doc.core_properties
            if core_props.title:
                metadata["title"] = core_props.title
            if core_props.author:
                metadata["author"] = core_props.author
            if core_props.revision:
                metadata["revision"] = core_props.revision
        except Exception:
            pass

        return ExtractionResult(
            document_name=filename,
            file_type="docx",
            total_pages=None,  # DOCX is reflowable without pages until rendered
            total_sections=len(unique_sections),
            total_characters=len(full_text),
            total_words=words,
            total_tokens=total_tokens,
            full_text=full_text,
            chunks=chunks,
            metadata=metadata,
        )
