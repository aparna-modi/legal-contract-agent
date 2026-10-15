import re
from typing import Any, Dict, List, Optional, Tuple

# Pre-compiled regex patterns for legal clause classification
TAXONOMY_PATTERNS = {
    "Termination": [
        re.compile(r"\b(?:terminat(?:e|ion|ing)|cancel(?:lation)?|cure period|default by (?:purchaser|vendor|party)|walk away|exit notice)\b", re.IGNORECASE),
        re.compile(r"\b(?:for cause|without cause|prior written notice)\b", re.IGNORECASE),
    ],
    "Indemnity & Defense": [
        re.compile(r"\b(?:indemnif(?:y|ication)|hold harmless|defend(?:ing)?|third[- ]party claims?|attorney(?:'s)? fees?|legal expenses?)\b", re.IGNORECASE),
    ],
    "Limitation of Liability": [
        re.compile(r"\b(?:limitation of liability|aggregate liability|consequential damages|punitive damages|maximum liability|not exceed)\b", re.IGNORECASE),
    ],
    "Governing Law & Jurisdiction": [
        re.compile(r"\b(?:governing law|jurisdiction|laws of (?:the State of|India|Karnataka|Delaware|California)|civil courts situated in|exclusive jurisdiction)\b", re.IGNORECASE),
    ],
    "Dispute Resolution & Arbitration": [
        re.compile(r"\b(?:arbitrat(?:ion|or)|sole arbitrator|arbitral tribunal|mediation|amicable settlement|conciliation act)\b", re.IGNORECASE),
    ],
    "Confidentiality & Non-Disclosure": [
        re.compile(r"\b(?:confidential(?:ity)?|non[- ]disclosure|trade secrets?|proprietary information|disclose)\b", re.IGNORECASE),
    ],
    "Payment Terms & Consideration": [
        re.compile(r"\b(?:purchase consideration|sale consideration|payment schedule|advance amount|token amount|balance consideration|earnest money|invoice|payable within|rtgs|cheque)\b", re.IGNORECASE),
    ],
    "Representations, Warranties & Covenants": [
        re.compile(r"\b(?:representations? and warrant(?:ies|y)|warrants? to the|marketable title|free from all encumbrances|covenants? to|clean title)\b", re.IGNORECASE),
    ],
    "Force Majeure": [
        re.compile(r"\b(?:force majeure|acts? of god|unforeseen circumstances|pandemic|epidemic|lockdown|civil commotion)\b", re.IGNORECASE),
    ],
    "Property Schedule & Conveyance": [
        re.compile(r"\b(?:schedule [ab]|apartment no|super built[- ]up area|undivided share|uds|car parking|khata|rera registration)\b", re.IGNORECASE),
    ],
    "Parties & Preamble": [
        re.compile(r"\b(?:this agreement (?:is )?entered into between|by and between|between the parties|party of the (?:first|other|second) part)\b", re.IGNORECASE),
        re.compile(r"\b(?:vendor|purchaser)\b.{1,50}\b(?:residing at|aged about)\b", re.IGNORECASE),
    ],
}

# Substantive exclusion patterns: phrases that represent structure rather than clauses
NON_CLAUSE_PATTERNS = [
    re.compile(r"^(?:between|and|whereas|recitals?|in witness whereof|witnesses:?|schedule [ab]:?)$", re.IGNORECASE),
    re.compile(r"^page \d+(?: of \d+)?$", re.IGNORECASE),
    re.compile(r"^(?:vendor|purchaser):?$", re.IGNORECASE),
    re.compile(r"^\d+[\.\)]?\s*$", re.IGNORECASE),
]

# Risk indicators for heuristic assessment
RISK_PATTERNS = {
    "high": [
        (re.compile(r"\b(?:liquidated damages of|interest at 18%|forfeit (?:a sum|all|deposit)|terminate immediately without notice|without limitation|unlimited liability)\b", re.IGNORECASE), "High financial penalty, forfeiture, or immediate termination clause"),
        (re.compile(r"\b(?:indemnif(?:y|ication) .+ against any and all claims|third[- ]party claims?)\b", re.IGNORECASE), "Broad indemnity obligation with exposure to third-party claims"),
        (re.compile(r"\b(?:non-compete within a \d+[- ]mile radius|twelve \(\d+\) months following termination)\b", re.IGNORECASE), "Restrictive non-compete covenant restricting business activity"),
    ],
    "medium": [
        (re.compile(r"\b(?:sole discretion|within (?:seven|ten|fifteen) \(\d+\) days|cure notice|grace period of thirty|sole arbitration)\b", re.IGNORECASE), "Strict contractual deadline, sole arbitrator appointment, or short cure window"),
        (re.compile(r"\b(?:specific performance|subject to receipt of a satisfactory legal title)\b", re.IGNORECASE), "Conditional milestone or specific performance liability"),
    ],
}


from extractors.utils import is_heading

def is_substantive_clause(text: str) -> bool:
    """Determine whether text represents an actual legal clause vs structural heading or noise."""
    cleaned = text.strip()
    if not cleaned or len(cleaned) < 25:
        return False

    first_line = cleaned.split("\n")[0].strip()
    # Reject standalone 1-line structural headings
    if len(cleaned.split("\n")) == 1 and (is_heading(first_line) or first_line.isupper() or first_line.endswith(":")):
        return False

    for pat in NON_CLAUSE_PATTERNS:
        if pat.match(first_line) and len(cleaned.split("\n")) <= 2:
            return False

    words = cleaned.split()
    if len(words) < 5:
        return False

    return True


def classify_clause(text: str, section_heading: Optional[str] = None) -> str:
    """Classify a clause into a canonical legal taxonomy category."""
    text_lower = text.lower()
    head_lower = (section_heading or "").lower()

    # Priority matching against legal taxonomy
    scores: Dict[str, int] = {}
    for category, patterns in TAXONOMY_PATTERNS.items():
        score = 0
        for pat in patterns:
            # Heading match is strong signal (weight = 10)
            if head_lower and pat.search(head_lower):
                score += 10
            matches = pat.findall(text_lower)
            score += len(matches)
        if score > 0:
            scores[category] = score

    if scores:
        best_cat = max(scores.items(), key=lambda x: x[1])[0]
        return best_cat

    # Fallback to section heading if clean, otherwise general
    if section_heading and len(section_heading.strip()) > 3:
        clean_head = re.sub(r"^\d+[\.\)]\s*", "", section_heading).strip()
        if clean_head and clean_head.lower() not in ["agreement", "contract", "general"]:
            return clean_head.title()

    return "General Provision"


def assess_clause_risk(text: str, clause_type: str) -> Tuple[str, str]:
    """
    Assess clause risk rating (high / medium / low) and generate explanatory reasoning.
    Adheres to OJT Project Design Template Section 3.2.
    """
    text_lower = text.lower()

    # 1. Check High Risk patterns
    for pat, reason in RISK_PATTERNS["high"]:
        if pat.search(text_lower):
            return "high", reason

    # 2. Check Medium Risk patterns
    for pat, reason in RISK_PATTERNS["medium"]:
        if pat.search(text_lower):
            return "medium", reason

    # 3. Categorical baselines
    if clause_type in ["Indemnity & Defense", "Limitation of Liability"]:
        return "medium", f"Standard {clause_type.lower()} requiring legal review"
    elif clause_type == "Termination":
        return "medium", "Termination mechanism defining exit terms and notice obligations"

    return "low", "Standard commercial clause with normal rights and obligations"


class ClauseClassifierService:
    @staticmethod
    def process_chunks_into_clauses(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filters raw extraction chunks to retain only substantive legal clauses,
        classifies their legal taxonomy, and assigns heuristic risk severity.
        """
        clauses: List[Dict[str, Any]] = []

        for idx, chunk in enumerate(chunks):
            text = chunk.get("text", "").strip()
            heading = chunk.get("section_heading") or chunk.get("section")

            # Filter out non-clause noise
            if not is_substantive_clause(text):
                continue

            category = classify_clause(text, heading)
            risk_level, risk_reason = assess_clause_risk(text, category)

            clauses.append({
                "clause_id": chunk.get("chunk_id") or f"clause_{idx+1:03d}",
                "clause_type": category,
                "text": text,
                "page_number": chunk.get("page_number") or chunk.get("page") or 1,
                "section_heading": heading or "General",
                "risk_level": risk_level,
                "risk_reason": risk_reason,
            })

        return clauses


clause_service = ClauseClassifierService()
