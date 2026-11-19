import re
from typing import Any, Dict, List, Optional, Tuple

from extractors.utils import is_heading

# Legal taxonomy rules ordered by clause domain.
TAXONOMY_PATTERNS: Dict[str, List[re.Pattern]] = {
    "Termination": [
        re.compile(
            r"\b(?:terminat(?:e|ion|ing)|cancel(?:lation)?|cure period|default by (?:purchaser|vendor|party)|walk away|exit notice|notice of termination)\b",
            re.IGNORECASE,
        ),
        re.compile(r"\b(?:for cause|without cause|for convenience|prior written notice)\b", re.IGNORECASE),
    ],
    "Indemnity & Defense": [
        re.compile(
            r"\b(?:indemnif(?:y|ication)|hold harmless|defend(?:ing)?|third[- ]party claims?|attorney(?:'s)? fees?|legal expenses?)\b",
            re.IGNORECASE,
        ),
    ],
    "Limitation of Liability": [
        re.compile(
            r"\b(?:limitation of liability|aggregate liability|consequential damages|punitive damages|maximum liability|liability cap|not exceed|indirect damages)\b",
            re.IGNORECASE,
        ),
    ],
    "Intellectual Property": [
        re.compile(
            r"\b(?:intellectual property|work product|work made for hire|copyright|patent(?:able)?|trademark|source code|license grant|ownership of deliverables|ip rights)\b",
            re.IGNORECASE,
        ),
    ],
    "Non-Compete & Restrictive Covenants": [
        re.compile(
            r"\b(?:non[- ]compete|non[- ]solicitation|restrictive covenants?|competitive business|solicit (?:any )?(?:employees|clients|customers))\b",
            re.IGNORECASE,
        ),
    ],
    "Confidentiality & Non-Disclosure": [
        re.compile(
            r"\b(?:confidential(?:ity)?|non[- ]disclosure|trade secrets?|proprietary information|disclose|nda)\b",
            re.IGNORECASE,
        ),
    ],
    "Payment Terms & Consideration": [
        re.compile(
            r"\b(?:purchase consideration|sale consideration|payment schedule|payment terms|advance amount|token amount|balance consideration|earnest money|invoice|payable within|compensation|salary|retainer|rtgs|cheque|late fee)\b",
            re.IGNORECASE,
        ),
    ],
    "Governing Law & Jurisdiction": [
        re.compile(
            r"\b(?:governing law|jurisdiction|laws of (?:the State of|India|Karnataka|Delaware|California|New York)|civil courts situated in|exclusive jurisdiction|venue)\b",
            re.IGNORECASE,
        ),
    ],
    "Dispute Resolution & Arbitration": [
        re.compile(
            r"\b(?:arbitrat(?:ion|or)|sole arbitrator|arbitral tribunal|mediation|amicable settlement|conciliation act|dispute resolution)\b",
            re.IGNORECASE,
        ),
    ],
    "Renewal & Auto-Renewal": [
        re.compile(
            r"\b(?:auto(?:matic(?:ally)?)?[- ]?renew(?:al|s)?|renewal term|evergreen|successive (?:one|two|\d+)[- ]year terms?)\b",
            re.IGNORECASE,
        ),
    ],
    "Representations, Warranties & Covenants": [
        re.compile(
            r"\b(?:representations? and warrant(?:ies|y)|warrants? to the|marketable title|free from all encumbrances|covenants? to|clean title|as[- ]is|disclaimer of warranties)\b",
            re.IGNORECASE,
        ),
    ],
    "Force Majeure": [
        re.compile(
            r"\b(?:force majeure|acts? of god|unforeseen circumstances|pandemic|epidemic|lockdown|civil commotion|beyond (?:its |the )?reasonable control)\b",
            re.IGNORECASE,
        ),
    ],
    "Property Schedule & Conveyance": [
        re.compile(
            r"\b(?:schedule [ab]|apartment no|super built[- ]up area|undivided share|uds|car parking|khata|rera registration|premises|leasehold)\b",
            re.IGNORECASE,
        ),
    ],
    "Parties & Preamble": [
        re.compile(
            r"\b(?:this agreement (?:is )?entered into between|by and between|between the parties|party of the (?:first|other|second) part)\b",
            re.IGNORECASE,
        ),
        re.compile(r"\b(?:vendor|purchaser|lessor|lessee|employer|employee)\b.{1,50}\b(?:residing at|aged about|having its registered office)\b", re.IGNORECASE),
    ],
}

# Structural noise lines that should not be saved as standalone clauses.
NON_CLAUSE_PATTERNS = [
    re.compile(r"^(?:between|and|whereas|recitals?|in witness whereof|witnesses:?|schedule [ab]:?)$", re.IGNORECASE),
    re.compile(r"^page \d+(?: of \d+)?$", re.IGNORECASE),
    re.compile(r"^(?:vendor|purchaser|employer|employee|client|contractor):?$", re.IGNORECASE),
    re.compile(r"^\d+[\.\)]?\s*$", re.IGNORECASE),
]

# Heuristic risk signals with plain-English explanations.
RISK_PATTERNS: Dict[str, List[Tuple[re.Pattern, str]]] = {
    "high": [
        (
            re.compile(
                r"\b(?:liquidated damages of|interest at (?:1[5-9]|[2-9]\d)%|forfeit (?:a sum|all|the )?(?:deposit|amount)|terminate immediately without (?:prior )?notice|without limitation|unlimited liability|uncapped liability)\b",
                re.IGNORECASE,
            ),
            "Exposes a party to steep financial penalties, deposit forfeiture, uncapped liability, or immediate termination without notice.",
        ),
        (
            re.compile(
                r"\b(?:indemnif(?:y|ication).{0,80}against any and all claims|broad third[- ]party claims?|indemnify.{0,40}negligence)\b",
                re.IGNORECASE,
            ),
            "Broad indemnification obligation that may create uncapped exposure to third-party claims and legal costs.",
        ),
        (
            re.compile(
                r"\b(?:non[- ]compete.{0,60}(?:\d+[- ]mile radius|(?:twelve|twenty[- ]four|12|24)\s*(?:\(\d+\)\s*)?months)|worldwide non[- ]compete)\b",
                re.IGNORECASE,
            ),
            "Restrictive non-compete covenant that limits future work or business activity after termination.",
        ),
        (
            re.compile(
                r"\b(?:irrevocably assigns? all (?:right|title|intellectual property)|waives? all moral rights)\b",
                re.IGNORECASE,
            ),
            "Broad irrevocable IP assignment that may transfer pre-existing or background work without carve-outs.",
        ),
    ],
    "medium": [
        (
            re.compile(
                r"\b(?:sole discretion|within (?:five|seven|ten|fifteen|\d{1,2})\s*(?:\(\d+\)\s*)?days|cure notice|grace period of thirty|sole arbitrat(?:ion|or))\b",
                re.IGNORECASE,
            ),
            "Contains unilateral discretion, a short cure/payment deadline, or a sole-arbitrator dispute mechanism.",
        ),
        (
            re.compile(
                r"\b(?:auto(?:matic(?:ally)?)?[- ]?renew(?:al|s)?|evergreen)\b",
                re.IGNORECASE,
            ),
            "Automatic renewal clause that can lock parties into another term if cancellation notice is missed.",
        ),
        (
            re.compile(
                r"\b(?:specific performance|subject to receipt of a satisfactory legal title|as[- ]is without warranty)\b",
                re.IGNORECASE,
            ),
            "Conditional obligation, warranty disclaimer, or equitable specific-performance remedy.",
        ),
    ],
}

# Baseline clauses expected in most commercial agreements.
EXPECTED_CORE_CLAUSES: List[Tuple[str, str, str]] = [
    (
        "Termination",
        "high",
        "No explicit termination or exit terms were detected; unclear how either party can end the agreement.",
    ),
    (
        "Limitation of Liability",
        "high",
        "No liability cap was found, which can leave parties exposed to uncapped consequential damages.",
    ),
    (
        "Payment Terms & Consideration",
        "medium",
        "No clear payment schedule, pricing, or consideration clause was detected.",
    ),
    (
        "Confidentiality & Non-Disclosure",
        "medium",
        "No confidentiality obligations were detected to protect sensitive commercial or client information.",
    ),
    (
        "Governing Law & Jurisdiction",
        "medium",
        "No governing law or venue clause was found to establish which courts or laws apply in a dispute.",
    ),
    (
        "Dispute Resolution & Arbitration",
        "low",
        "No formal dispute resolution or arbitration process was detected.",
    ),
    (
        "Force Majeure",
        "low",
        "No force majeure clause was detected to excuse performance during extraordinary disruptions.",
    ),
]


def is_substantive_clause(text: str) -> bool:
    """Return True if text looks like a real clause rather than a bare heading or page footer."""
    cleaned = text.strip()
    if not cleaned or len(cleaned) < 25:
        return False

    lines = cleaned.split("\n")
    first_line = lines[0].strip()

    if len(lines) == 1 and (is_heading(first_line) or first_line.isupper() or first_line.endswith(":")):
        return False

    for pat in NON_CLAUSE_PATTERNS:
        if pat.match(first_line) and len(lines) <= 2:
            return False

    return len(cleaned.split()) >= 5


def classify_clause(text: str, section_heading: Optional[str] = None) -> str:
    """Assign a clause to the best matching legal taxonomy category."""
    text_lower = text.lower()
    head_lower = (section_heading or "").lower()

    scores: Dict[str, int] = {}
    for category, patterns in TAXONOMY_PATTERNS.items():
        score = 0
        for pat in patterns:
            if head_lower and pat.search(head_lower):
                score += 10
            score += len(pat.findall(text_lower))
        if score > 0:
            scores[category] = score

    if scores:
        return max(scores.items(), key=lambda item: item[1])[0]

    if section_heading and len(section_heading.strip()) > 3:
        clean_head = re.sub(r"^\d+(?:\.\d+)*[\.\)]\s*", "", section_heading).strip()
        if clean_head and clean_head.lower() not in ("agreement", "contract", "general"):
            return clean_head.title()

    return "General Provision"


def assess_clause_risk(text: str, clause_type: str) -> Tuple[str, str]:
    """Rate a clause as high, medium, or low risk with a concise rationale."""
    text_lower = text.lower()

    for pat, reason in RISK_PATTERNS["high"]:
        if pat.search(text_lower):
            return "high", reason

    for pat, reason in RISK_PATTERNS["medium"]:
        if pat.search(text_lower):
            return "medium", reason

    if clause_type in ("Indemnity & Defense", "Limitation of Liability", "Non-Compete & Restrictive Covenants"):
        return "medium", f"Contains {clause_type.lower()} obligations that warrant closer legal review."
    if clause_type == "Termination":
        return "medium", "Defines contract exit mechanics, cure obligations, or notice periods."

    return "low", "Routine commercial provision with standard rights and obligations."


def detect_missing_clauses(classified_clauses: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Flag core commercial protections that appear to be absent from the contract."""
    present_types = {str(c.get("clause_type", "")).strip() for c in classified_clauses}
    missing: List[Dict[str, str]] = []
    for clause_type, severity, reason in EXPECTED_CORE_CLAUSES:
        if clause_type not in present_types:
            missing.append(
                {
                    "clause_type": clause_type,
                    "severity": severity,
                    "reason": reason,
                }
            )
    return missing


def summarize_risk_profile(
    classified_clauses: List[Dict[str, Any]],
    missing_clauses: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Aggregate clause risk counts into a 0-100 risk score and overall level."""
    counts = {"high": 0, "medium": 0, "low": 0}
    for clause in classified_clauses:
        level = str(clause.get("risk_level", "low")).lower()
        if level in counts:
            counts[level] += 1
        else:
            counts["low"] += 1

    missing_high = sum(1 for m in (missing_clauses or []) if m.get("severity") == "high")
    raw_score = counts["high"] * 22 + counts["medium"] * 8 + missing_high * 12
    score = min(100, raw_score)

    if counts["high"] >= 2 or score >= 60:
        overall_level = "high"
    elif counts["high"] == 1 or counts["medium"] >= 2 or score >= 28:
        overall_level = "medium"
    else:
        overall_level = "low"

    return {
        "high": counts["high"],
        "medium": counts["medium"],
        "low": counts["low"],
        "overall_level": overall_level,
        "score": score,
    }


class ClauseClassifierService:
    @staticmethod
    def process_chunks_into_clauses(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter raw document chunks into classified, risk-rated legal clauses."""
        clauses: List[Dict[str, Any]] = []

        for idx, chunk in enumerate(chunks):
            text = chunk.get("text", "").strip()
            heading = chunk.get("section_heading") or chunk.get("section")

            if not is_substantive_clause(text):
                continue

            category = classify_clause(text, heading)
            risk_level, risk_reason = assess_clause_risk(text, category)

            clauses.append(
                {
                    "clause_id": chunk.get("chunk_id") or f"clause_{idx + 1:03d}",
                    "clause_type": category,
                    "text": text,
                    "page_number": chunk.get("page_number") or chunk.get("page") or 1,
                    "section_heading": heading or "General",
                    "risk_level": risk_level,
                    "risk_reason": risk_reason,
                }
            )

        return clauses


clause_service = ClauseClassifierService()
