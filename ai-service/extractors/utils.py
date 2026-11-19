import re
from typing import Optional

import tiktoken

_ENCODER: Optional[tiktoken.Encoding] = None


def get_token_encoder() -> tiktoken.Encoding:
    global _ENCODER
    if _ENCODER is None:
        try:
            _ENCODER = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _ENCODER = tiktoken.encoding_for_model("gpt-4o")
    return _ENCODER


def count_tokens(text: str) -> int:
    """Count tokens via tiktoken cl100k_base, falling back to a word-based estimate."""
    if not text:
        return 0
    try:
        encoder = get_token_encoder()
        return len(encoder.encode(text, disallowed_special=()))
    except Exception:
        # Rough fallback: ~0.75 words per token.
        words = len(text.split())
        return max(1, int(words * 1.33))


def clean_text(text: str) -> str:
    """Normalize punctuation and line breaks while preserving paragraph boundaries."""
    if not text:
        return ""
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    lines = [line.strip() for line in text.split("\n")]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


LEGAL_HEADING_PATTERNS = [
    re.compile(
        r"^(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|EXHIBIT|APPENDIX|ATTACHMENT)\s+[A-Z0-9IVXLCDM]+(?:[\.\-:][\s\w&/,\-\(\)]+)?",
        re.IGNORECASE,
    ),
    re.compile(r"^\d+(?:\.\d+)*\s*[\.\-:]?\s+[A-Z][A-Za-z0-9\s,&/:'\"\-\(\)]{2,120}$"),
    re.compile(r"^[A-Z0-9\s\-_,&/:'\"\(\)]{4,120}$"),
]


def is_heading(line: str) -> bool:
    """Return True if a single line looks like a contract section or clause title."""
    line = line.strip()
    if not line or len(line) > 120 or len(line) < 3:
        return False

    # Ignore regular sentences that happen to start with a number.
    if line.endswith(".") and not re.match(r"^\d+(?:\.\d+)*\.$", line):
        if len(line.split()) > 8:
            return False

    return any(pattern.match(line) for pattern in LEGAL_HEADING_PATTERNS)
