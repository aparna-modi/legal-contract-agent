import re
from typing import Any, Dict, List, Optional, Tuple

from extractors.utils import is_heading

TAXONOMY_PATTERNS: Dict[str, List[re.Pattern]] = {
    "Termination": [
        re.compile(r"\b(?:terminat(?:e|ion|ing)|cancel(?:lation)?|cure (?:period|notice)|default by (?:purchaser|vendor|party)|walk away|exit notice|notice of termination|liquidated damages|forfeit)\b", re.I),
        re.compile(r"\b(?:for cause|without cause|for convenience|prior written notice)\b", re.I),
    ],
    "Indemnity & Defense": [
        re.compile(r"\b(?:indemnif(?:y|ication)|indemnity|hold harmless|defend(?:ing)?|third[- ]party claims?|attorney(?:'s)? fees?|legal expenses?)\b", re.I),
    ],
    "Limitation of Liability": [
        re.compile(r"\b(?:limitation of liability|aggregate liability|consequential damages|punitive damages|maximum liability|liability cap|not exceed|indirect damages)\b", re.I),
    ],
    "Intellectual Property": [
        re.compile(r"\b(?:intellectual property|work product|work made for hire|copyright|patent(?:able)?|trademark|source code|license grant|ownership of deliverables|ip rights)\b", re.I),
    ],
    "Non-Compete & Restrictive Covenants": [
        re.compile(r"\b(?:non[- ]compete|non[- ]solicitation|restrictive covenants?|competitive business|solicit (?:any )?(?:employees|clients|customers))\b", re.I),
    ],
    "Confidentiality & Non-Disclosure": [
        re.compile(r"\b(?:confidential(?:ity)?|non[- ]disclosure|trade secrets?|proprietary information|disclose|nda)\b", re.I),
    ],
    "Payment Terms & Consideration": [
        re.compile(r"\b(?:purchase consideration|sale consideration|payment schedule|payment terms|advance amount|token amount|balance consideration|earnest money|milestone payment|invoice|payable within|compensation|salary|retainer|rtgs|cheque|late fee|stamp duty|registration fees?|capital gains tax|tds|property tax(?:es)?|maintenance charges?|sinking fund|statutory outgoings)\b", re.I),
    ],
    "Governing Law & Jurisdiction": [
        re.compile(r"\b(?:governing law|jurisdiction|laws of (?:the State of|the Republic of India|India|Karnataka|Delaware|California|New York)|civil courts situated in|exclusive jurisdiction|venue)\b", re.I),
    ],
    "Dispute Resolution & Arbitration": [
        re.compile(r"\b(?:arbitrat(?:ion|or)|sole arbitrator|arbitral tribunal|mediation|amicable settlement|conciliation act|dispute resolution)\b", re.I),
    ],
    "Renewal & Auto-Renewal": [
        re.compile(r"\b(?:auto(?:matic(?:ally)?)?[- ]?renew(?:al|s)?|renewal term|evergreen|successive (?:one|two|\d+)[- ]year terms?)\b", re.I),
    ],
    "Representations, Warranties & Covenants": [
        re.compile(r"\b(?:representations? and warrant(?:ies|y)|represents? and warrants?|warrants? to the|marketable title|free from all encumbrances|parent title documents|mother deed|encumbrance certificate|title (?:defect|verification|scrutiny)|covenants? to|clean title|as[- ]is|disclaimer of warranties)\b", re.I),
    ],
    "Force Majeure": [
        re.compile(r"\b(?:force majeure|acts? of god|unforeseen circumstances|pandemic|epidemic|lockdown|civil commotion|beyond (?:its |the )?reasonable control)\b", re.I),
    ],
    "Property Schedule & Conveyance": [
        re.compile(r"\b(?:schedule ['\"]?[ab]['\"]?|apartment (?:no|flat)|super built[- ]up area|undivided share|uds|car parking|khata|rera registration|premises|leasehold|sale deed|vacant(?:,\s*peaceful,)?\s*(?:physical\s*)?possession|handover of physical possession|closing date|grace period|bescom|bwssb|bounded on)\b", re.I),
    ],
    "Parties & Preamble": [
        re.compile(r"\b(?:this agreement (?:to sell )?(?:is )?(?:entered into|executed)|by and between|between the parties|party of the (?:first|other|second|one) part|in witness whereof)\b", re.I),
        re.compile(r"\b(?:vendor|purchaser|lessor|lessee|employer|employee)\b.{1,80}\b(?:residing at|aged about|having its registered office|hereinafter called|son of|daughter of)\b", re.I),
        re.compile(r"\b(?:holding pan|aadhaar no|first party|second party|witnesses:)\b", re.I),
    ],
}

INDIAN_LAW_MAP: Dict[str, str] = {
    "Termination": "Indian Contract Act, 1872 — Sec. 39 (Repudiation/Breach), Sec. 73 (Compensation for Breach) & Sec. 74 (Liquidated Damages)",
    "Indemnity & Defense": "Indian Contract Act, 1872 — Sec. 124 (Contract of Indemnity) & Sec. 125 (Rights of Indemnity-Holder)",
    "Limitation of Liability": "Indian Contract Act, 1872 — Sec. 73 (Remoteness of Damages) & Sec. 74 (Reasonable Cap on Liquidated Damages)",
    "Intellectual Property": "Copyright Act, 1957 — Sec. 17 (First Ownership of Copyright) & Sec. 19 (Mode of Assignment); Patents Act, 1970",
    "Non-Compete & Restrictive Covenants": "Indian Contract Act, 1872 — Sec. 27 (Agreements in Restraint of Trade are generally void post-termination)",
    "Confidentiality & Non-Disclosure": "Indian Contract Act, 1872 — Sec. 73; Information Technology Act, 2000 — Sec. 72A; Digital Personal Data Protection Act, 2023",
    "Payment Terms & Consideration": "Indian Contract Act, 1872 — Sec. 2(d) & Sec. 25 (Lawful Consideration), Sec. 55 (Time as Essence of Contract); Negotiable Instruments Act, 1881 — Sec. 138",
    "Governing Law & Jurisdiction": "Code of Civil Procedure, 1908 — Sec. 20 (Territorial Jurisdiction) & Indian Contract Act, 1872 — Sec. 28 (Choice of Exclusive Forum)",
    "Dispute Resolution & Arbitration": "Arbitration and Conciliation Act, 1996 — Sec. 7 (Arbitration Agreement), Sec. 9 (Interim Relief), Sec. 11 & Sec. 21",
    "Renewal & Auto-Renewal": "Indian Contract Act, 1872 — Sec. 10 (Free Consent) & Sec. 62 (Novation/Alteration of Contract)",
    "Representations, Warranties & Covenants": "Indian Contract Act, 1872 — Sec. 17–19 (Fraud/Misrepresentation); Transfer of Property Act, 1882 — Sec. 55 (Seller's Title Disclosure)",
    "Force Majeure": "Indian Contract Act, 1872 — Sec. 32 (Contingent Contracts) & Sec. 56 (Doctrine of Frustration / Impossibility)",
    "Property Schedule & Conveyance": "Transfer of Property Act, 1882 — Sec. 54 & 55 (Sale of Immovable Property); Registration Act, 1908 — Sec. 17; RERA, 2016",
    "Parties & Preamble": "Indian Contract Act, 1872 — Sec. 10 & Sec. 11 (Competency of Parties & Valid Contract Formation); Indian Stamp Act, 1899 — Sec. 35",
    "General Provision": "Indian Contract Act, 1872 — Sec. 10 (General Enforceability of Agreements)",
}

# Dual-mapped IPC (1860) <-> Bharatiya Nyaya Sanhita (BNS, 2023) & criminal/quasi-criminal remedies
# applicable when contractual conduct crosses from civil breach into dishonest inducement, misappropriation,
# forgery, cyber-theft, or dishonoured instruments.
IPC_BNS_MAP: Dict[str, str] = {
    "Payment Terms & Consideration": "IPC Sec. 415/420 <-> BNS Sec. 318 (Cheating on dishonest advance retention); IPC Sec. 405/406 <-> BNS Sec. 316 (Criminal Breach of Trust on entrusted funds); NI Act, 1881 Sec. 138 (Cheque Dishonour)",
    "Confidentiality & Non-Disclosure": "IT Act, 2000 Sec. 43, 66 & 72A (Unauthorized Data/Trade Secret Disclosure); IPC Sec. 405/406 <-> BNS Sec. 316 (Criminal Breach of Trust over confidential records)",
    "Intellectual Property": "Copyright Act, 1957 Sec. 63 (Criminal Copyright Infringement); IT Act, 2000 Sec. 66 (Source Code Theft); IPC Sec. 406 <-> BNS Sec. 316",
    "Representations, Warranties & Covenants": "IPC Sec. 415/420 <-> BNS Sec. 318 (Fraudulent Inducement / Concealment of Title); IPC Sec. 463/468/471 <-> BNS Sec. 336/340 (Forged Title/Documents)",
    "Property Schedule & Conveyance": "IPC Sec. 420 <-> BNS Sec. 318 (Fraudulent Sale / Double Alienation); IPC Sec. 406 <-> BNS Sec. 316 (Misappropriation of Earnest Money); RERA, 2016 Sec. 18 & 61",
    "Termination": "IPC Sec. 406 <-> BNS Sec. 316 (Wrongful Retention of Deposit/Assets Post-Termination); Specific Relief Act, 1963 Sec. 10 & 38 (Injunction / Specific Performance)",
    "Indemnity & Defense": "CPC, 1908 Order 37 (Summary Recovery on Liquidated Indemnity); IPC Sec. 420 <-> BNS Sec. 318 (Where loss stems from deliberate fraud)",
    "Dispute Resolution & Arbitration": "Arbitration & Conciliation Act, 1996 Sec. 9 (Urgent Court Interim Relief) & Sec. 17; Commercial Courts Act, 2015 Sec. 12A (Pre-Institution Mediation)",
}

NON_CLAUSE_PATTERNS = [
    re.compile(r"^(?:between|and|whereas|recitals?|in witness whereof|witnesses:?|schedule ['\"]?[ab]['\"]?:?)$", re.I),
    re.compile(r"^page \d+(?: of \d+)?$", re.I),
    re.compile(r"^(?:vendor|purchaser|employer|employee|client|contractor):?$", re.I),
    re.compile(r"^\d+[\.\)]?\s*$", re.I),
]

NOISE_HEADING_LABELS = {
    "agreement", "contract", "general", "between", "whereas", "property", "and",
    "witnesses", "now therefore", "recitals", "preamble", "vendor", "purchaser",
}

RISK_PATTERNS: Dict[str, List[Tuple[re.Pattern, str]]] = {
    "high": [
        (
            re.compile(r"\b(?:liquidated damages of|interest at (?:1[5-9]|[2-9]\d)%|late fee(?:s)? (?:of )?(?:[3-9]|\d{2})%|forfeit (?:a sum|all|the )?(?:deposit|amount|advance)?|terminate immediately without (?:prior )?notice|terminate at any time without (?:cause|notice)|unilateral(?:ly)? terminat|without limitation|unlimited liability|uncapped liability)\b", re.I),
            "Exposes a party to steep financial penalties, high late fees, deposit forfeiture, uncapped liability, or one-sided/immediate termination without notice.",
        ),
        (
            re.compile(r"\b(?:indemnif(?:y|ication).{0,100}against any and all claims|broad third[- ]party claims?|indemnify.{0,40}negligence)\b", re.I),
            "Broad indemnification obligation that may create uncapped exposure to third-party claims and legal costs.",
        ),
        (
            re.compile(r"\b(?:non[- ]compete.{0,60}(?:\d+[- ]mile radius|(?:twelve|twenty[- ]four|12|24)\s*(?:\(\d+\)\s*)?months)|worldwide non[- ]compete)\b", re.I),
            "Restrictive non-compete covenant that limits future work or business activity (generally unenforceable post-termination under Sec. 27, Indian Contract Act).",
        ),
        (
            re.compile(r"\b(?:irrevocably assigns? all (?:right|title|intellectual property)|waives? all moral rights)\b", re.I),
            "Broad irrevocable IP assignment that may transfer pre-existing or background work without carve-outs.",
        ),
    ],
    "medium": [
        (
            re.compile(r"\b(?:sole discretion|within (?:five|seven|ten|fifteen|twenty[- ]one|\d{1,2})\s*(?:\(\d+\)\s*)?(?:calendar\s+|business\s+|banking\s+)?days|cure notice|grace period of thirty|sole arbitrat(?:ion|or))\b", re.I),
            "Contains unilateral discretion, a short cure/payment deadline, or a sole-arbitrator dispute mechanism.",
        ),
        (
            re.compile(r"\b(?:auto(?:matic(?:ally)?)?[- ]?renew(?:al|s)?|evergreen)\b", re.I),
            "Automatic renewal clause that can lock parties into another term if cancellation notice is missed.",
        ),
        (
            re.compile(r"\b(?:specific performance|subject to receipt of a satisfactory legal title|as[- ]is without warranty|borne solely by the purchaser|appropriate jurisdiction|applicable laws? as determined by|mutually agreed later)\b", re.I),
            "Conditional obligation, sole cost allocation, vague governing law/jurisdiction, warranty disclaimer, or equitable specific-performance remedy.",
        ),
    ],
}

EXPECTED_CORE_CLAUSES: List[Tuple[str, str, str]] = [
    ("Termination", "high", "No explicit termination or exit terms were detected; unclear how either party can end the agreement."),
    ("Limitation of Liability", "high", "No liability cap was found, which can leave parties exposed to uncapped consequential damages."),
    ("Payment Terms & Consideration", "medium", "No clear payment schedule, pricing, or consideration clause was detected."),
    ("Confidentiality & Non-Disclosure", "medium", "No confidentiality obligations were detected to protect sensitive commercial or client information."),
    ("Governing Law & Jurisdiction", "medium", "No governing law or venue clause was found to establish which courts or laws apply in a dispute."),
    ("Dispute Resolution & Arbitration", "low", "No formal dispute resolution or arbitration process was detected."),
    ("Force Majeure", "low", "No force majeure clause was detected to excuse performance during extraordinary disruptions."),
]


def get_indian_law_reference(clause_type: str, text: str = "") -> str:
    """Return the applicable Indian Act and Section citation for a clause."""
    lower = (text or "").lower()
    extras: List[str] = []
    if "specific relief" in lower or "specific performance" in lower:
        extras.append("Specific Relief Act, 1963 — Sec. 10 (Specific Performance of Contracts)")
    if "stamp duty" in lower or "registration" in lower:
        extras.append("Registration Act, 1908 — Sec. 17 & Indian Stamp Act, 1899")
    if "rera" in lower:
        extras.append("Real Estate (Regulation and Development) Act (RERA), 2016")
    if "liquidated damages" in lower or "forfeit" in lower:
        extras.append("Indian Contract Act, 1872 — Sec. 74 (Reasonable Compensation, not punitive penalty)")
    if "tds" in lower or "capital gains" in lower:
        extras.append("Income-tax Act, 1961 — Sec. 194-IA (1% TDS on Immovable Property >= INR 50 Lakhs) & Sec. 45 (Capital Gains)")

    base = INDIAN_LAW_MAP.get(clause_type, INDIAN_LAW_MAP["General Provision"])
    for extra in extras:
        act_name = extra.split("—")[0].strip().lower()
        if act_name not in base.lower():
            base = f"{base}; {extra}"
    return base


def get_ipc_bns_reference(clause_type: str, text: str = "") -> str:
    """Return applicable IPC (1860) <-> BNS (2023) and procedural litigation hooks when relevant."""
    lower = (text or "").lower()
    refs: List[str] = []
    base = IPC_BNS_MAP.get(clause_type, "")
    if base:
        refs.append(base)
    if any(k in lower for k in ("fraud", "misrepresent", "false statement", "conceal", "deceit", "encumbrance")):
        refs.append("IPC Sec. 415/420 <-> BNS Sec. 318 (Cheating & Fraudulent Inducement)")
    if any(k in lower for k in ("forfeit", "deposit", "advance", "escrow", "trust", "entrust")):
        refs.append("IPC Sec. 405/406 <-> BNS Sec. 316 (Criminal Breach of Trust)")
    if any(k in lower for k in ("cheque", "post-dated", "dishonour", "negotiable instrument")):
        refs.append("Negotiable Instruments Act, 1881 — Sec. 138 & 141 (Cheque Dishonour)")
    if any(k in lower for k in ("forg", "tamper", "counterfeit", "fabricated")):
        refs.append("IPC Sec. 463/468/471 <-> BNS Sec. 336/340 (Forgery & False Document)")
    if any(k in lower for k in ("source code", "data breach", "personal data", "unauthorized access", "cyber")):
        refs.append("IT Act, 2000 — Sec. 43, 66 & 72A; DPDP Act, 2023")
    if any(k in lower for k in ("threat", "coerc", "intimidat")):
        refs.append("IPC Sec. 503/506 <-> BNS Sec. 351 (Criminal Intimidation)")

    dedup: List[str] = []
    seen: set[str] = set()
    for item in refs:
        key = item.split("(")[0].strip().lower()
        if key not in seen:
            seen.add(key)
            dedup.append(item)
    return "; ".join(dedup[:2])


def build_plain_english_fallback(clause_type: str, text: str, risk_reason: str = "") -> str:
    """Create a concise counsel-grade practical interpretation when running offline."""
    clean = re.sub(r"\s+", " ", (text or "").strip())
    first_sent = re.split(r"(?<=[.!?])\s+", clean)[0][:220]
    summaries = {
        "Parties & Preamble": f"Establishes the legal identities, capacity, and execution anchor of the contracting parties. Key excerpt: {first_sent}",
        "Termination": f"Governs exit rights, default triggers, notice mechanics, and post-termination settlement obligations. {risk_reason}",
        "Payment Terms & Consideration": f"Fixes commercial consideration, invoicing milestones, tax/duty allocation, and default payment remedies. Key excerpt: {first_sent}",
        "Limitation of Liability": f"Allocates maximum financial exposure, liability caps, and consequential damage exclusions across the agreement. {risk_reason}",
        "Indemnity & Defense": f"Allocates defense control and reimbursement liability for third-party claims, breaches, and statutory losses. {risk_reason}",
        "Non-Compete & Restrictive Covenants": "Imposes post-contractual competitive restraints; under Section 27 of the Indian Contract Act, 1872, post-termination non-competes are generally void unless tied to goodwill sale.",
        "Confidentiality & Non-Disclosure": "Establishes confidentiality boundaries, permitted disclosures, survival duration, and proprietary data safeguards.",
        "Governing Law & Jurisdiction": f"Designates substantive governing law and exclusive territorial court venue for formal proceedings. Key excerpt: {first_sent}",
        "Dispute Resolution & Arbitration": "Sets out pre-litigation escalation, arbitration seat, tribunal composition, and binding enforcement procedure.",
        "Property Schedule & Conveyance": "Defines property boundaries, area specifications, title conveyance conditions, utility transfers, and handover timelines.",
        "Representations, Warranties & Covenants": "Creates enforceable legal assurances on authority, marketable title, encumbrances, and statutory compliance.",
        "Force Majeure": "Defines extraordinary excusing events, notice prerequisites, and suspension or termination thresholds during prolonged disruption.",
        "Intellectual Property": "Separates pre-existing Background IP from foreground deliverables and specifies conditions governing IP transfer or licensing.",
    }
    return summaries.get(clause_type, f"Establishes binding contractual obligations under {clause_type}: {first_sent}").strip()


def is_substantive_clause(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned or len(cleaned) < 25:
        return False
    lines = [ln.strip() for ln in cleaned.split("\n") if ln.strip()]
    first_line = lines[0]
    if len(lines) == 1 and (is_heading(first_line) or first_line.isupper() or first_line.endswith(":")):
        return False
    for pat in NON_CLAUSE_PATTERNS:
        if pat.match(first_line) and len(lines) <= 2:
            return False
    return len(cleaned.split()) >= 5


def _clean_heading_for_category(section_heading: Optional[str]) -> str:
    if not section_heading:
        return ""
    cleaned = re.sub(r"^\d+(?:\.\d+)*\s*[\.\-\):]?\s*", "", section_heading).strip(" :-")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned or len(cleaned) > 50 or len(cleaned.split()) > 6:
        return ""
    if cleaned.lower() in NOISE_HEADING_LABELS:
        return ""
    return cleaned.title()


def classify_clause(text: str, section_heading: Optional[str] = None) -> str:
    text_lower = text.lower()
    head_lower = (section_heading or "").lower()
    scores: Dict[str, int] = {}

    for category, patterns in TAXONOMY_PATTERNS.items():
        score = 0
        for pat in patterns:
            if head_lower and pat.search(head_lower):
                score += 8
            score += len(pat.findall(text_lower))
        if score > 0:
            scores[category] = score

    if scores:
        return max(scores.items(), key=lambda item: item[1])[0]

    fallback_cat = _clean_heading_for_category(section_heading)
    return fallback_cat or "General Provision"


def assess_clause_risk(text: str, clause_type: str) -> Tuple[str, str]:
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


_CORE_PRESENCE_SIGNALS: Dict[str, re.Pattern] = {
    "Termination": re.compile(r"\b(?:may terminate|termination for|right to terminate|termination notice|cure period)\b", re.I),
    "Limitation of Liability": re.compile(r"\b(?:limitation of liability|aggregate liability|liability cap|consequential damages|shall not exceed)\b", re.I),
    "Payment Terms & Consideration": re.compile(r"\b(?:commercial fee schedule|payment terms|purchase consideration|sale consideration|invoices? (?:shall be |are )?payable|net\s+\d+|milestone payment|subscription fees?)\b", re.I),
    "Confidentiality & Non-Disclosure": re.compile(r"\b(?:confidential information|non[- ]disclosure|strict confidence|proprietary information)\b", re.I),
    "Governing Law & Jurisdiction": re.compile(r"\b(?:governed by(?: and construed in accordance with)? the laws of|exclusive jurisdiction|governing law)\b", re.I),
    "Dispute Resolution & Arbitration": re.compile(r"\b(?:arbitration|arbitral tribunal|sole arbitrator|conciliation act|dispute resolution|mediation)\b", re.I),
    "Force Majeure": re.compile(r"\b(?:force majeure|acts? of god|beyond (?:its |a party's |the )?reasonable control)\b", re.I),
}


def detect_missing_clauses(
    classified_clauses: List[Dict[str, Any]],
    full_text: str = "",
) -> List[Dict[str, str]]:
    present_types = {str(c.get("clause_type", "")).strip() for c in classified_clauses}
    # Combine substantive clause texts (and optional full_text) so clauses merged under a parent
    # section heading (e.g., Arbitration inside Governing Law, or Fees in Schedule A) are not falsely flagged missing.
    clause_blob = "\n".join(str(c.get("text") or "") for c in classified_clauses)
    combined_blob = f"{clause_blob}\n{full_text or ''}" if full_text else clause_blob

    missing: List[Dict[str, str]] = []
    for ct, sev, reason in EXPECTED_CORE_CLAUSES:
        if ct in present_types:
            continue
        sig = _CORE_PRESENCE_SIGNALS.get(ct)
        if sig and combined_blob and sig.search(combined_blob):
            continue
        missing.append({"clause_type": ct, "severity": sev, "reason": reason})
    return missing


def summarize_risk_profile(
    classified_clauses: List[Dict[str, Any]],
    missing_clauses: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    counts = {"high": 0, "medium": 0, "low": 0}
    for clause in classified_clauses:
        level = str(clause.get("risk_level", "low")).lower()
        counts[level if level in counts else "low"] += 1
    missing_high = sum(1 for m in (missing_clauses or []) if m.get("severity") == "high")
    score = min(100, counts["high"] * 22 + counts["medium"] * 8 + missing_high * 12)
    overall = (
        "high" if (counts["high"] >= 2 or score >= 60)
        else ("medium" if (counts["high"] == 1 or counts["medium"] >= 2 or score >= 28) else "low")
    )
    return {**counts, "overall_level": overall, "score": score}


class ClauseClassifierService:
    @staticmethod
    def process_chunks_into_clauses(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        clauses: List[Dict[str, Any]] = []
        for idx, chunk in enumerate(chunks):
            text = (chunk.get("text") or "").strip()
            heading = chunk.get("section_heading") or chunk.get("section")
            if not is_substantive_clause(text):
                continue
            category = classify_clause(text, heading)
            risk_level, risk_reason = assess_clause_risk(text, category)
            clauses.append({
                "clause_id": chunk.get("chunk_id") or f"clause_{idx + 1:03d}",
                "clause_type": category,
                "text": text,
                "page_number": chunk.get("page_number") or chunk.get("page") or 1,
                "section_heading": heading or "General",
                "risk_level": risk_level,
                "risk_reason": risk_reason,
                "plain_english": build_plain_english_fallback(category, text, risk_reason),
                "indian_law_ref": get_indian_law_reference(category, text),
                "ipc_bns_ref": get_ipc_bns_reference(category, text),
            })
        return clauses


clause_service = ClauseClassifierService()
