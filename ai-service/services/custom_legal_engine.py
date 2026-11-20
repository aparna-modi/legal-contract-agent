import re
from collections import Counter
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple


class CustomLegalEngine:
    """
    Rule-assisted legal clause classifier, risk evaluator, missing-clause detector,
    and contract-to-contract comparator.
    """

    CLAUSE_PATTERNS: List[Tuple[str, List[str]]] = [
        ("Limitation of Liability", [r"\bliabilit(?:y|ies)\b", r"\bindemnif", r"\bconsequential damages\b", r"\bliability cap\b"]),
        ("Termination", [r"\bterminat(?:e|ion)\b", r"\bcure period\b", r"\bwind[\s-]?down\b", r"\beffective date of termination\b"]),
        ("Confidentiality / NDA", [r"\bconfidential\b", r"\bnon[\s-]?disclosure\b", r"\bproprietary information\b", r"\btrade secret"]),
        ("Intellectual Property", [r"\bintellectual property\b", r"\bcopyright\b", r"\bpatent\b", r"\bwork made for hire\b", r"\blicen[sc]e"]),
        ("Payment & Fees", [r"\bpayment\b", r"\binvoice\b", r"\bfee(?:s)?\b", r"\blate fee\b", r"\bnet\s+\d+\b", r"\btaxes?\b"]),
        ("Indemnification", [r"\bindemnify\b", r"\bhold harmless\b", r"\bdefend and indemnify\b"]),
        ("Governing Law & Jurisdiction", [r"\bgoverning law\b", r"\bjurisdiction\b", r"\barbitration\b", r"\bvenue\b", r"\bcourts of\b"]),
        ("Data Protection & Privacy", [r"\bpersonal data\b", r"\bdata protection\b", r"\bprivacy\b", r"\bgdpr\b", r"\bsecurity incident\b", r"\bbreach notification\b"]),
        ("Warranties & Representations", [r"\bwarrant(?:y|ies)\b", r"\brepresent(?:s|ation)\b", r"\bas[\s-]?is\b", r"\bmerchantability\b"]),
        ("Force Majeure", [r"\bforce majeure\b", r"\bbeyond reasonable control\b", r"\bact of god\b"]),
        ("Non-Compete / Non-Solicit", [r"\bnon[\s-]?compet", r"\bnon[\s-]?solicit", r"\brestrictive covenant\b"]),
        ("Assignment & Change of Control", [r"\bassign(?:ment)?\b", r"\bchange of control\b", r"\bmerger\b", r"\bsuccessors and assigns\b"]),
        ("Term & Renewal", [r"\binitial term\b", r"\brenewal\b", r"\bauto[\s-]?renew", r"\bexpiration\b"]),
        ("Dispute Resolution", [r"\bdispute\b", r"\bmediation\b", r"\barbitrator\b", r"\blitigation\b"]),
    ]

    HIGH_RISK_PATTERNS: List[Tuple[str, str]] = [
        (r"\bunlimited liability\b", "Mentions unlimited liability without a clear financial cap."),
        (r"\bindemnif\w*\s+any\s+and\s+all\b", "Broad indemnification wording may expose a party to wide third-party claims."),
        (r"\bsole\s+and\s+absolute\s+discretion\b", "Grants unilateral discretion with minimal objective recourse."),
        (r"\bwithout\s+(?:prior\s+)?notice\b", "Allows action or termination without advance notice."),
        (r"\bwaive[sd]?\s+(?:all\s+)?(?:right|claim|trial\s+by\s+jury)\b", "Includes a broad waiver of legal rights or remedies."),
        (r"\bperpetual\s+and\s+irrevocable\b", "Locks in rights or obligations permanently without revocation."),
        (r"\bauto(?:matic(?:ally)?)?[\s-]?renew\b", "Contains automatic renewal terms that can lock in extended commitments."),
    ]

    MEDIUM_RISK_PATTERNS: List[Tuple[str, str]] = [
        (r"\bnet\s+(?:60|90|120)\b", "Extended payment window may impact cash flow timing."),
        (r"\b\d+\s+days?\s+(?:written\s+)?notice\b", "Specifies a notice window that should be checked against operational timelines."),
        (r"\barbitration\b", "Routes disputes to arbitration rather than standard court proceedings."),
        (r"\bnon[\s-]?solicit\w*\b", "Restricts hiring or soliciting certain personnel or clients."),
    ]

    BASELINE_PROTECTIONS: List[Tuple[str, str, str]] = [
        ("Limitation of Liability", "high", "No explicit liability cap or limitation clause was detected."),
        ("Termination", "high", "No termination rights or exit mechanism was detected."),
        ("Confidentiality / NDA", "medium", "No confidentiality or non-disclosure provision was detected."),
        ("Governing Law & Jurisdiction", "medium", "No governing law or venue/jurisdiction clause was detected."),
    ]

    def classify_clause(self, text: str, section_heading: Optional[str] = None) -> str:
        haystack = f"{section_heading or ''}\n{text or ''}".lower()
        best_label = "General Provision"
        best_score = 0

        for label, patterns in self.CLAUSE_PATTERNS:
            score = sum(1 for pat in patterns if re.search(pat, haystack, re.IGNORECASE))
            if score > best_score:
                best_score = score
                best_label = label

        return best_label

    def score_clause_risk(self, text: str, clause_type: str) -> Tuple[str, str]:
        lowered = (text or "").lower()
        reasons: List[str] = []

        for pattern, reason in self.HIGH_RISK_PATTERNS:
            if re.search(pattern, lowered, re.IGNORECASE):
                reasons.append(reason)

        if reasons:
            return "high", " ".join(dict.fromkeys(reasons))

        for pattern, reason in self.MEDIUM_RISK_PATTERNS:
            if re.search(pattern, lowered, re.IGNORECASE):
                reasons.append(reason)

        if reasons:
            return "medium", " ".join(dict.fromkeys(reasons))

        if clause_type in {"Limitation of Liability", "Indemnification", "Termination"} and len(lowered) < 120:
            return "medium", f"Short '{clause_type}' clause—verify scope, exceptions, and remedies."

        return "low", "No high-severity risk triggers detected in this provision."

    def evaluate_clauses(self, clauses: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, str]]]:
        enriched: List[Dict[str, Any]] = []
        counts = Counter({"high": 0, "medium": 0, "low": 0})
        present_types = set()

        for item in clauses:
            text = str(item.get("text", "") or "")
            heading = item.get("section_heading") or item.get("sectionHeading") or "General"
            c_type = item.get("clause_type") or item.get("clauseType")
            if not c_type or c_type == "General Provision":
                c_type = self.classify_clause(text, heading)

            risk_level = item.get("risk_level") or item.get("riskLevel")
            risk_reason = item.get("risk_reason") or item.get("riskReason")
            if not risk_level or not risk_reason:
                inferred_level, inferred_reason = self.score_clause_risk(text, c_type)
                risk_level = risk_level or inferred_level
                risk_reason = risk_reason or inferred_reason

            normalized_level = str(risk_level).lower()
            if normalized_level not in counts:
                normalized_level = "low"

            counts[normalized_level] += 1
            present_types.add(c_type)

            enriched.append(
                {
                    **item,
                    "clause_type": c_type,
                    "risk_level": normalized_level,
                    "risk_reason": risk_reason,
                    "page_number": item.get("page_number") or item.get("pageNumber") or 1,
                    "section_heading": heading,
                }
            )

        total = max(1, len(enriched))
        weighted = (counts["high"] * 100 + counts["medium"] * 45 + counts["low"] * 10) / total
        score = min(100, round(weighted))

        if counts["high"] > 0 or score >= 65:
            overall_level = "high"
        elif counts["medium"] > 0 or score >= 30:
            overall_level = "medium"
        else:
            overall_level = "low"

        risk_summary = {
            "high": counts["high"],
            "medium": counts["medium"],
            "low": counts["low"],
            "overall_level": overall_level,
            "score": score,
        }

        missing_clauses: List[Dict[str, str]] = []
        for req_type, severity, reason in self.BASELINE_PROTECTIONS:
            if req_type not in present_types:
                missing_clauses.append(
                    {
                        "clause_type": req_type,
                        "severity": severity,
                        "reason": reason,
                    }
                )

        return enriched, risk_summary, missing_clauses

    def extract_key_facts(self, full_text: str) -> Dict[str, Any]:
        text = full_text or ""
        effective_match = re.search(
            r"(?:effective\s+(?:as\s+of\s+)?date[:\s]+)([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
            text,
            re.IGNORECASE,
        )
        law_match = re.search(
            r"(?:governed\s+by\s+(?:the\s+)?laws?\s+of\s+)([A-Za-z\s,]+?)(?:\.|;|,?\s+without\s+regard)",
            text,
            re.IGNORECASE,
        )
        notice_match = re.search(
            r"(\d+\s+(?:calendar\s+|business\s+)?days?)\s+(?:prior\s+)?written\s+notice",
            text,
            re.IGNORECASE,
        )

        return {
            "parties": [],
            "effective_date": effective_match.group(1).strip() if effective_match else "Not specified",
            "expiry_or_term": "Not specified",
            "payment_terms": "Not specified",
            "notice_period": notice_match.group(1).strip() if notice_match else "Not specified",
            "governing_law": law_match.group(1).strip() if law_match else "Not specified",
            "key_obligations": [],
        }

    def compare_clause_lists(
        self,
        contract_a_title: str,
        clauses_a: List[Dict[str, Any]],
        contract_b_title: str,
        clauses_b: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        matched_b_indices = set()
        diffs: List[Dict[str, Any]] = []
        status_counts = Counter({"unchanged": 0, "modified": 0, "added": 0, "removed": 0})

        for idx_a, ca in enumerate(clauses_a):
            type_a = ca.get("clause_type") or "General Provision"
            text_a = str(ca.get("text", "") or "")
            risk_a = str(ca.get("risk_level", "low")).lower()

            best_idx_b: Optional[int] = None
            best_ratio = 0.0

            for idx_b, cb in enumerate(clauses_b):
                if idx_b in matched_b_indices:
                    continue
                type_b = cb.get("clause_type") or "General Provision"
                text_b = str(cb.get("text", "") or "")
                ratio = SequenceMatcher(None, text_a.lower(), text_b.lower()).ratio()
                if type_a == type_b:
                    ratio += 0.15
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_idx_b = idx_b

            if best_idx_b is not None and best_ratio >= 0.35:
                matched_b_indices.add(best_idx_b)
                cb = clauses_b[best_idx_b]
                text_b = str(cb.get("text", "") or "")
                risk_b = str(cb.get("risk_level", "low")).lower()

                raw_sim = SequenceMatcher(None, text_a.strip(), text_b.strip()).ratio()
                diff_status = "unchanged" if raw_sim >= 0.98 and risk_a == risk_b else "modified"
                status_counts[diff_status] += 1

                diffs.append(
                    {
                        "status": diff_status,
                        "clause_type": type_a,
                        "similarity": round(raw_sim, 3),
                        "risk_a": risk_a,
                        "risk_b": risk_b,
                        "clause_a": ca,
                        "clause_b": cb,
                    }
                )
            else:
                status_counts["removed"] += 1
                diffs.append(
                    {
                        "status": "removed",
                        "clause_type": type_a,
                        "similarity": 0.0,
                        "risk_a": risk_a,
                        "risk_b": None,
                        "clause_a": ca,
                        "clause_b": None,
                    }
                )

        for idx_b, cb in enumerate(clauses_b):
            if idx_b not in matched_b_indices:
                status_counts["added"] += 1
                diffs.append(
                    {
                        "status": "added",
                        "clause_type": cb.get("clause_type") or "General Provision",
                        "similarity": 0.0,
                        "risk_a": None,
                        "risk_b": str(cb.get("risk_level", "low")).lower(),
                        "clause_a": None,
                        "clause_b": cb,
                    }
                )

        return {
            "contract_a_title": contract_a_title,
            "contract_b_title": contract_b_title,
            "summary": {
                "total_compared": len(diffs),
                "unchanged": status_counts["unchanged"],
                "modified": status_counts["modified"],
                "added": status_counts["added"],
                "removed": status_counts["removed"],
            },
            "differences": diffs,
        }


custom_legal_engine = CustomLegalEngine()
