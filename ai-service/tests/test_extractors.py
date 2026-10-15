import pytest
from extractors import (
    DOCXDocumentExtractor,
    PDFDocumentExtractor,
    TXTDocumentExtractor,
    get_extractor,
)


class TestPDFExtractor:
    def test_extract_pdf_pages_and_headings(self, sample_pdf_bytes):
        extractor = PDFDocumentExtractor()
        result = extractor.extract_from_bytes(sample_pdf_bytes, "agreement.pdf")

        assert result.document_name == "agreement.pdf"
        assert result.file_type == "pdf"
        assert result.total_pages == 2
        assert result.total_sections >= 2
        assert result.total_words > 0
        assert result.total_tokens > 0
        assert len(result.chunks) >= 2

        # Verify page-number tracking
        page_numbers = {c.page_number for c in result.chunks if c.page_number is not None}
        assert 1 in page_numbers
        assert 2 in page_numbers

        # Verify offsets
        for chunk in result.chunks:
            extracted_slice = result.full_text[chunk.start_char : chunk.end_char]
            assert extracted_slice == chunk.text
            assert chunk.token_count > 0

    def test_extract_corrupted_pdf(self):
        extractor = PDFDocumentExtractor()
        with pytest.raises(ValueError, match="Failed to parse PDF document"):
            extractor.extract_from_bytes(b"not a valid pdf", "corrupt.pdf")


class TestDOCXExtractor:
    def test_extract_docx_headings_and_tables(self, sample_docx_bytes):
        extractor = DOCXDocumentExtractor()
        result = extractor.extract_from_bytes(sample_docx_bytes, "nda.docx")

        assert result.document_name == "nda.docx"
        assert result.file_type == "docx"
        assert result.total_sections >= 2
        assert result.total_words > 0
        assert result.total_tokens > 0

        # Check table extraction
        table_chunks = [c for c in result.chunks if c.chunk_type == "table"]
        assert len(table_chunks) == 1
        assert "Term Field" in table_chunks[0].text
        assert "Delaware, USA" in table_chunks[0].text
        assert "|" in table_chunks[0].text

        # Check heading extraction
        headings = [c for c in result.chunks if c.chunk_type == "heading"]
        assert len(headings) >= 2

        # Verify character offsets
        for chunk in result.chunks:
            extracted_slice = result.full_text[chunk.start_char : chunk.end_char]
            assert extracted_slice == chunk.text

    def test_extract_corrupted_docx(self):
        extractor = DOCXDocumentExtractor()
        with pytest.raises(ValueError, match="Failed to parse DOCX document"):
            extractor.extract_from_bytes(b"corrupted docx stream", "bad.docx")


class TestTXTExtractor:
    def test_extract_txt_indentation_and_subclauses(self, sample_txt_content):
        extractor = TXTDocumentExtractor()
        content_bytes = sample_txt_content.encode("utf-8")
        result = extractor.extract_from_bytes(content_bytes, "employment.txt")

        assert result.document_name == "employment.txt"
        assert result.file_type == "txt"
        assert result.total_sections >= 3
        assert result.total_words > 0
        assert result.total_tokens > 0

        # Check subclauses
        subclauses = [c for c in result.chunks if c.metadata.get("is_subclause")]
        assert len(subclauses) >= 1

        # Verify indentation tracking
        indents = [c.metadata.get("indent_spaces", 0) for c in result.chunks]
        assert any(indent > 0 for indent in indents)

        # Verify character offsets
        for chunk in result.chunks:
            extracted_slice = result.full_text[chunk.start_char : chunk.end_char]
            assert extracted_slice == chunk.text


class TestExtractorFactory:
    def test_get_extractor_by_extension(self):
        assert isinstance(get_extractor("contract.pdf"), PDFDocumentExtractor)
        assert isinstance(get_extractor("CONTRACT.PDF"), PDFDocumentExtractor)
        assert isinstance(get_extractor("terms.docx"), DOCXDocumentExtractor)
        assert isinstance(get_extractor("notes.txt"), TXTDocumentExtractor)
        assert isinstance(get_extractor(".docx"), DOCXDocumentExtractor)

    def test_unsupported_extension_raises(self):
        with pytest.raises(ValueError, match="Unsupported file extension"):
            get_extractor("malicious.exe")
