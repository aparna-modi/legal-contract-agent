"""
Publication-Grade Law-Firm DOCX Export Engine powered by python-docx.

Generates clean, formatted Microsoft Word (.docx) manuscripts with formal legal typography,
1-inch margins, running headers and dynamic Page X of Y footers, bold uppercase Article headings,
hierarchical sub-clause indentation, shaded Schedule tables, and 2-column Signature & Witness tables.
"""

import io
import re
from typing import Any, Dict, List, Optional

from docx import Document as DocxDocument
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Inches, Pt, RGBColor

_NAVY = RGBColor(0x18, 0x22, 0x30)
_INK = RGBColor(0x1E, 0x24, 0x2B)
_MUTED = RGBColor(0x5A, 0x63, 0x70)
_ACCENT = RGBColor(0x0F, 0x6E, 0x65)


def _add_page_number_fields(run_parent) -> None:
    """Insert Word XML PAGE and NUMPAGES fields into footer paragraph."""
    for label, field_name in [("Page ", "PAGE"), (" of ", "NUMPAGES")]:
        r_lbl = run_parent.add_run(label)
        r_lbl.font.name = "Georgia"
        r_lbl.font.size = Pt(8.5)
        r_lbl.font.color.rgb = _MUTED

        r_fld = run_parent.add_run()
        r_fld.font.name = "Georgia"
        r_fld.font.size = Pt(8.5)
        r_fld.font.color.rgb = _MUTED
        fld_begin = OxmlElement("w:fldChar")
        fld_begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = f" {field_name} "
        fld_sep = OxmlElement("w:fldChar")
        fld_sep.set(qn("w:fldCharType"), "separate")
        fld_end = OxmlElement("w:fldChar")
        fld_end.set(qn("w:fldCharType"), "end")
        r_fld._r.append(fld_begin)
        r_fld._r.append(instr)
        r_fld._r.append(fld_sep)
        r_fld._r.append(fld_end)


def _set_cell_shading(cell, fill_hex: str) -> None:
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    cell._tc.get_or_add_tcPr().append(shading)


def _add_bottom_border(paragraph, color_hex: str = "C9C3B4") -> None:
    pPr = paragraph._p.get_or_add_pPr()
    pBdr = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        f'<w:bottom w:val="single" w:sz="6" w:space="6" w:color="{color_hex}"/>'
        f"</w:pBdr>"
    )
    pPr.append(pBdr)


def _is_article_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 105:
        return False
    if re.match(r"^(?:ARTICLE|SECTION|SCHEDULE|ANNEXURE|EXHIBIT|PROTECTIVE ADDENDUM)\s+[A-Z0-9IVX]+", s, re.I):
        return True
    if re.match(r"^\d{1,2}\.\s+[A-Z][A-Z0-9\s,&/\-()]{2,}$", s):
        return True
    if s in ("RECITALS", "PREAMBLE", "DEFINITIONS", "DEFINITIONS AND INTERPRETATION", "WITNESSES", "EXECUTION"):
        return True
    return False


def _is_subclause_line(line: str) -> bool:
    return bool(re.match(r"^(?:\d{1,2}\.\d+(?:\.\d+)?|\([a-z]\)|\([ivxlcdm]+\))\s+", line.strip()))


def _is_markdown_table_line(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.endswith("|") and s.count("|") >= 3


def _render_markdown_table(doc: DocxDocument, table_lines: List[str]) -> None:
    rows: List[List[str]] = []
    for ln in table_lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if all(re.match(r"^[:\-]+$", c.replace(" ", "")) for c in cells if c):
            continue
        rows.append(cells)
    if not rows:
        return
    cols = max(len(r) for r in rows)
    tbl = doc.add_table(rows=len(rows), cols=cols)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.style = "Table Grid"
    for r_idx, row_vals in enumerate(rows):
        for c_idx in range(cols):
            val = row_vals[c_idx] if c_idx < len(row_vals) else ""
            cell = tbl.cell(r_idx, c_idx)
            if r_idx == 0:
                _set_cell_shading(cell, "EFECE4")
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            run = p.add_run(val)
            run.font.name = "Georgia"
            run.font.size = Pt(9.5)
            run.bold = r_idx == 0
            run.font.color.rgb = _NAVY if r_idx == 0 else _INK
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.space_after = Pt(6)


def build_legal_docx(
    title: str,
    full_text: str,
    subtitle: str = "",
    jurisdiction: str = "",
    document_kind: str = "contract",
    counsel_notes: Optional[List[str]] = None,
    disclaimer: str = "",
) -> bytes:
    """Build a law-firm formatted .docx byte buffer from structured agreement or legal notice text."""
    doc = DocxDocument()

    # Configure formal 1-inch margins across all sections
    for section in doc.sections:
        section.top_margin = Inches(0.95)
        section.bottom_margin = Inches(0.95)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.different_first_page_header_footer = True

        # Running Header (pages 2+)
        hdr_p = section.header.paragraphs[0]
        hdr_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hdr_run = hdr_p.add_run(f"{(title or 'AGREEMENT').upper()}  |  CONFIDENTIAL")
        hdr_run.font.name = "Georgia"
        hdr_run.font.size = Pt(8.5)
        hdr_run.font.color.rgb = _MUTED

        # Running Footer (pages 2+)
        ftr_p = section.footer.paragraphs[0]
        ftr_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _add_page_number_fields(ftr_p)

        # First-page subtle footer
        fp_ftr = section.first_page_footer.paragraphs[0]
        fp_ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _add_page_number_fields(fp_ftr)

    # Set default Normal style
    normal = doc.styles["Normal"]
    normal.font.name = "Georgia"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = _INK

    # Formal Title Block
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_p.paragraph_format.space_before = Pt(4)
    title_p.paragraph_format.space_after = Pt(4)
    t_run = title_p.add_run((title or "COMMERCIAL AGREEMENT").strip().upper())
    t_run.font.name = "Georgia"
    t_run.font.size = Pt(15)
    t_run.bold = True
    t_run.font.color.rgb = _NAVY

    meta_bits = [b for b in [subtitle.strip(), f"Governing Law: {jurisdiction.strip()}" if jurisdiction.strip() else ""] if b]
    if meta_bits:
        meta_p = doc.add_paragraph()
        meta_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        meta_p.paragraph_format.space_before = Pt(0)
        meta_p.paragraph_format.space_after = Pt(12)
        m_run = meta_p.add_run("   •   ".join(meta_bits))
        m_run.font.name = "Georgia"
        m_run.font.size = Pt(9.5)
        m_run.italic = True
        m_run.font.color.rgb = _MUTED
        _add_bottom_border(meta_p)
    else:
        _add_bottom_border(title_p)

    # Parse body lines into structured paragraphs, headings, Markdown tables, and signature blocks
    lines = (full_text or "").replace("\r\n", "\n").splitlines()
    # Skip duplicate uppercase title line at top of body
    first_non_empty = next((i for i, ln in enumerate(lines) if ln.strip()), None)
    if first_non_empty is not None and lines[first_non_empty].strip().upper() == (title or "").strip().upper():
        lines = lines[first_non_empty + 1 :]

    i = 0
    in_signature_section = False
    sig_lines: List[str] = []

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            i += 1
            continue

        # Detect Markdown table block
        if _is_markdown_table_line(stripped):
            tbl_buf = []
            while i < len(lines) and _is_markdown_table_line(lines[i]):
                tbl_buf.append(lines[i])
                i += 1
            _render_markdown_table(doc, tbl_buf)
            continue

        # Detect formal execution / signature section
        if document_kind != "legal_notice" and re.match(r"^IN WITNESS WHEREOF\b", stripped, re.I):
            in_signature_section = True
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(10)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            r = p.add_run(stripped)
            r.bold = True
            r.font.name = "Georgia"
            r.font.size = Pt(10.5)
            r.font.color.rgb = _NAVY
            i += 1
            continue

        if in_signature_section:
            sig_lines.append(stripped)
            i += 1
            continue

        if _is_article_heading(stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            r = p.add_run(stripped)
            r.bold = True
            r.font.name = "Georgia"
            r.font.size = Pt(11)
            r.font.color.rgb = _NAVY
            i += 1
            continue

        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY if len(stripped) > 65 else WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.18
        if _is_subclause_line(stripped):
            if re.match(r"^\([a-zivx]+\)\s+", stripped):
                p.paragraph_format.left_indent = Inches(0.45)
            else:
                p.paragraph_format.left_indent = Inches(0.22)

        # Bold leading sub-clause label (e.g., "1.1 Scope." or "WHEREAS,")
        lead_m = re.match(r"^((?:\d{1,2}\.\d+(?:\.\d+)?\s+[A-Z][A-Za-z0-9 &/\-]{1,48}[.:]|WHEREAS,?|NOW,\s+THEREFORE,?)\s+)(.*)$", stripped)
        if lead_m:
            r1 = p.add_run(lead_m.group(1))
            r1.bold = True
            r1.font.name = "Georgia"
            r1.font.size = Pt(10.5)
            r1.font.color.rgb = _NAVY
            r2 = p.add_run(lead_m.group(2))
            r2.font.name = "Georgia"
            r2.font.size = Pt(10.5)
            r2.font.color.rgb = _INK
        else:
            r = p.add_run(stripped)
            r.font.name = "Georgia"
            r.font.size = Pt(10.5)
            r.font.color.rgb = _INK
        i += 1

    # Render signature lines neatly in a 2-column execution table if present
    if sig_lines:
        sig_tbl = doc.add_table(rows=1, cols=2)
        sig_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        half = max(1, (len(sig_lines) + 1) // 2)
        left_lines = sig_lines[:half]
        right_lines = sig_lines[half:] or ["Authorized Signatory: _______________________", "Name & Designation: _______________________", "Date & Place: ______________________________"]
        for col_idx, col_lines in enumerate([left_lines, right_lines]):
            cell = sig_tbl.cell(0, col_idx)
            cell.paragraphs[0].paragraph_format.space_after = Pt(4)
            for idx_l, ln in enumerate(col_lines):
                p = cell.paragraphs[0] if idx_l == 0 else cell.add_paragraph()
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(4)
                r = p.add_run(ln)
                r.font.name = "Georgia"
                r.font.size = Pt(9.8)
                r.bold = idx_l == 0 or ln.lower().startswith("for ")
                r.font.color.rgb = _NAVY if r.bold else _INK

    # Optional Counsel Drafting / Review Notes Appendix on fresh page
    if counsel_notes:
        doc.add_page_break()
        ap_h = doc.add_paragraph()
        ap_h.paragraph_format.space_after = Pt(8)
        r = ap_h.add_run("COUNSEL REVIEW & NEGOTIATION NOTES")
        r.bold = True
        r.font.name = "Georgia"
        r.font.size = Pt(12)
        r.font.color.rgb = _ACCENT
        _add_bottom_border(ap_h)

        for idx_n, note in enumerate(counsel_notes, 1):
            np = doc.add_paragraph()
            np.paragraph_format.space_before = Pt(3)
            np.paragraph_format.space_after = Pt(5)
            np.paragraph_format.left_indent = Inches(0.2)
            nr = np.add_run(f"{idx_n}. {str(note).strip()}")
            nr.font.name = "Georgia"
            nr.font.size = Pt(9.8)
            nr.font.color.rgb = _INK

    if disclaimer:
        disc_p = doc.add_paragraph()
        disc_p.paragraph_format.space_before = Pt(16)
        dr = disc_p.add_run(disclaimer)
        dr.italic = True
        dr.font.name = "Georgia"
        dr.font.size = Pt(8.5)
        dr.font.color.rgb = _MUTED

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
