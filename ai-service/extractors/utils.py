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
    """Calculate token count using tiktoken cl100k_base with safe fallback."""
    if not text:
        return 0
    try:
        encoder = get_token_encoder()
        return len(encoder.encode(text, disallowed_special=()))
    except Exception:
        # Fallback estimation: average 1 token ≈ 0.75 words
        words = len(text.split())
        return max(1, int(words * 1.33))


def clean_text(text: str) -> str:
    """Normalize text while preserving essential legal formatting."""
    if not text:
        return ""
    # Normalize unicode non-breaking spaces and special quotes
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Clean whitespace per line
    lines = [line.strip() for line in text.split("\n")]
    cleaned = "\n".join(lines)
    # Remove runs of more than 2 blank lines
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# Common legal heading patterns
LEGAL_HEADING_PATTERNS = [
    re.compile(r"^(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|EXHIBIT|APPENDIX|ATTACHMENT)\s+[A-Z0-9IVXLCDM]+(?:[\.\-:][\s\w&/,\-\(\)]+)?", re.IGNORECASE),
    re.compile(r"^\d+(?:\.\d+)*\s*[\.\-:]?\s+[A-Z][A-Za-z0-9\s,&/:'\"\-\(\)]{2,120}$"),
    re.compile(r"^[A-Z0-9\s\-_,&/:'\"\(\)]{4,120}$"),  # All-caps headings
]


def is_heading(line: str) -> bool:
    """Detect if a text line represents a contract section or clause heading."""
    line = line.strip()
    if not line or len(line) > 120 or len(line) < 3:
        return False
    # Avoid classifying full regular sentences as headings
    if line.endswith(".") and not re.match(r"^\d+(?:\.\d+)*\.$", line):
        if len(line.split()) > 8:
            return False

    for pattern in LEGAL_HEADING_PATTERNS:
        if pattern.match(line):
            return True
    return False
