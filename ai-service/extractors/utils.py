import re
from typing import Optional

import tiktoken

_ENCODER: Optional[tiktoken.Encoding] = None

# Structural labels that almost always mark a section title on their own line.
_EXPLICIT_HEADING_RE = re.compile(
    r"^(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|EXHIBIT|APPENDIX|ATTACHMENT|ANNEXURE)\s+"
    r"[A-Z0-9IVXLCDM'\"]+(?:[\.\-:][\s\w&/,\-\(\)'\"]+)?$",
    re.IGNORECASE,
)

# Standalone short uppercase headings (e.g. "INDEMNITY", "FORCE MAJEURE", "BETWEEN:").
_ALL_CAPS_HEADING_RE = re.compile(r"^[A-Z0-9][A-Z0-9\s\-_,&/:'\"\(\)]{2,95}$")

# Numbered section headings like "1. PAYMENT TERMS" or "2.1 Purchase Consideration".
_NUMBERED_HEADING_RE = re.compile(
    r"^(?P<num>\d+(?:\.\d+)*)\s*[\.\-:]?\s+(?P<title>[A-Z][A-Za-z0-9\s,&/:'\"\-\(\)]{2,85})$"
)

# Numbered clause start such as "1.1 The property..." or "9.2 Default by Vendor:".
_NUMBERED_CLAUSE_RE = re.compile(r"^(?P<num>\d+\.\d+(?:\.\d+)*)\s+(?P<rest>.+)$")

# Common lowercase prose words that signal a wrapped sentence rather than a heading.
_PROSE_STOP_WORDS = {
    "the", "shall", "will", "that", "this", "with", "from", "have", "been",
    "which", "their", "there", "where", "event", "agree", "agrees", "hereby",
    "covenants", "represents", "warrants", "payable", "subject", "within",
    "unless", "provided", "permitted", "explicitly", "monthly", "after",
}


def get_token_encoder() -> tiktoken.Encoding:
    global _ENCODER
    if _ENCODER is None:
        try:
            _ENCODER = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _ENCODER = tiktoken.encoding_for_model("gpt-4o")
    return _ENCODER


def count_tokens(text: str) -> int:
    """Count tokens using tiktoken cl100k_base, with a simple word-based fallback."""
    if not text:
        return 0
    try:
        return len(get_token_encoder().encode(text, disallowed_special=()))
    except Exception:
        return max(1, int(len(text.split()) * 1.33))


def clean_text(text: str) -> str:
    """Normalize smart punctuation and excess line breaks while keeping paragraphs intact."""
    if not text:
        return ""
    replacements = (
        ("\u00a0", " "),
        ("\u200b", ""),
        ("\u2018", "'"),
        ("\u2019", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\r\n", "\n"),
        ("\r", "\n"),
    )
    for old, new in replacements:
        text = text.replace(old, new)

    lines = [line.strip() for line in text.split("\n")]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def extract_clause_number(line: str) -> Optional[str]:
    """Return the sub-clause number (e.g. '2.1', '9.2') if a line begins a numbered clause."""
    match = _NUMBERED_CLAUSE_RE.match(line.strip())
    return match.group("num") if match else None


# Short connector words that must never be mistaken for standalone section headings.
_HEADING_STOP_WORDS = {"and", "or", "the", "for", "nor", "but", "yet", "per", "not", "all", "any"}


def is_heading(line: str) -> bool:
    """Return True when a line looks like a real section title rather than wrapped prose."""
    text = line.strip()
    if not text or len(text) < 3 or len(text) > 100:
        return False

    if text.rstrip(":").lower() in _HEADING_STOP_WORDS:
        return False

    # Require at least two alphabetic characters so numbers or divider lines don't match.
    if len(re.findall(r"[A-Za-z]", text)) < 2:
        return False

    # Regular sentences ending with a period are rarely headings (except bare "1.").
    if text.endswith(".") and not re.match(r"^\d+(?:\.\d+)*\.$", text):
        if len(text.split()) > 6:
            return False

    if _EXPLICIT_HEADING_RE.match(text):
        return len(text.split()) <= 14

    if _ALL_CAPS_HEADING_RE.match(text) and text == text.upper():
        return len(text.split()) <= 12

    num_match = _NUMBERED_HEADING_RE.match(text)
    if num_match:
        title = num_match.group("title").strip()
        words = title.split()
        if len(words) > 9:
            return False

        # Sub-clause lines like "3.2 In the event the Purchaser's legal counsel..." are prose, not headings.
        lower_words = [w.strip(",.:;()\"'").lower() for w in words]
        prose_hits = sum(1 for w in lower_words if w in _PROSE_STOP_WORDS)
        if "." in num_match.group("num"):
            # Allow short sub-headings like "3.2 Immediate Termination" or "9.1 Default by Purchaser:"
            if prose_hits >= 2 or len(words) > 6:
                return False
            # If the title ends with a comma or starts a long clause body, it's wrapped prose.
            if title.endswith(","):
                return False
            non_cap_words = [
                w for w in words[1:]
                if w and w[0].islower() and w.lower() not in {"of", "and", "or", "by", "for", "to", "in", "on", "the", "a", "an", "with"}
            ]
            if len(non_cap_words) >= 2:
                return False
        else:
            # Top-level numbered headings like "1. PAYMENT TERMS" or "2. Term and Termination"
            if prose_hits >= 3 or title.endswith(","):
                return False

        return True

    return False
