import re
from typing import Dict, List, Optional
from extractors.base import DocumentChunk
from extractors.utils import get_token_encoder

_HEADING_PATTERNS = [
    re.compile(r"^(?:ARTICLE|SECTION|CLAUSE)\s+[IVXLC0-9]+(?:\.[0-9]+)*[:.\-\s]+.+", re.IGNORECASE),
    re.compile(r"^\d+(?:\.\d+){0,3}[\.)]\s+[A-Z][A-Za-z\s/&,-]{2,80}$"),
    re.compile(r"^[A-Z][A-Z\s/&,-]{3,70}$"),
]


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 100 or stripped.endswith("."):
        return False
    return any(pattern.match(stripped) for pattern in _HEADING_PATTERNS)


def chunk_contract_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
    """
    Split contract text into token windows with overlap while respecting
    boundary sentences where practical.
    """
    if not text or not text.strip():
        return []

    tokenizer = get_token_encoder()
    tokens = tokenizer.encode(text, disallowed_special=())
    if not tokens:
        return []

    chunks: List[str] = []
    step_size = max(1, chunk_size - overlap)

    for start in range(0, len(tokens), step_size):
        window = tokens[start : start + chunk_size]
        decoded = tokenizer.decode(window).strip()
        if decoded:
            chunks.append(decoded)
        if start + chunk_size >= len(tokens):
            break

    return chunks


def build_legal_chunks(
    full_text: str,
    max_tokens: int = 450,
    overlap_tokens: int = 80,
    page_number: Optional[int] = 1,
    default_heading: str = "General Provisions",
) -> List[DocumentChunk]:
    """
    Split contract text along legal section/clause headings first, then
    subdivide oversized sections into overlapping token windows while tracking
    character spans and token counts.
    """
    if not full_text or not full_text.strip():
        return []

    tokenizer = get_token_encoder()
    lines = full_text.splitlines(keepends=True)

    sections: List[Dict[str, object]] = []
    current_heading = default_heading
    current_lines: List[str] = []
    current_start: Optional[int] = None
    cursor = 0

    for line in lines:
        line_start = cursor
        cursor += len(line)
        cleaned = line.strip()

        if _looks_like_heading(cleaned):
            if current_lines:
                sec_text = "".join(current_lines).strip()
                if sec_text and current_start is not None:
                    sections.append(
                        {
                            "heading": current_heading,
                            "text": sec_text,
                            "start_char": current_start,
                        }
                    )
            current_heading = cleaned
            current_lines = [line]
            current_start = line_start
        else:
            if current_start is None:
                current_start = line_start
            current_lines.append(line)

    if current_lines:
        sec_text = "".join(current_lines).strip()
        if sec_text and current_start is not None:
            sections.append(
                {
                    "heading": current_heading,
                    "text": sec_text,
                    "start_char": current_start,
                }
            )

    if not sections:
        sections = [
            {
                "heading": default_heading,
                "text": full_text.strip(),
                "start_char": 0,
            }
        ]

    document_chunks: List[DocumentChunk] = []
    chunk_id = 0

    for sec in sections:
        heading = str(sec["heading"])
        sec_text = str(sec["text"])
        sec_start = int(sec["start_char"])
        tokens = tokenizer.encode(sec_text, disallowed_special=())
        token_total = len(tokens)

        if token_total <= max_tokens:
            end_char = sec_start + len(sec_text)
            document_chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    text=sec_text,
                    page_number=page_number,
                    section_heading=heading,
                    start_char=sec_start,
                    end_char=end_char,
                    token_count=token_total,
                    chunk_type="clause_section",
                    metadata={"strategy": "heading_boundary"},
                )
            )
            chunk_id += 1
        else:
            step = max(1, max_tokens - overlap_tokens)
            for start_idx in range(0, token_total, step):
                window = tokens[start_idx : start_idx + max_tokens]
                piece = tokenizer.decode(window).strip()
                if not piece:
                    continue
                found_pos = full_text.find(piece, max(0, sec_start - 20))
                start_char = found_pos if found_pos != -1 else sec_start
                end_char = start_char + len(piece)
                document_chunks.append(
                    DocumentChunk(
                        chunk_id=chunk_id,
                        text=piece,
                        page_number=page_number,
                        section_heading=heading,
                        start_char=start_char,
                        end_char=end_char,
                        token_count=len(window),
                        chunk_type="clause_subchunk",
                        metadata={
                            "strategy": "heading_plus_token_window",
                            "token_start": start_idx,
                        },
                    )
                )
                chunk_id += 1
                if start_idx + max_tokens >= token_total:
                    break

    return document_chunks