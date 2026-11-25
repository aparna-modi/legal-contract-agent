import os
from typing import Optional

from fastapi import HTTPException, UploadFile

from extractors import ExtractionResult, get_extractor
from services.clause_service import (
    clause_service,
    detect_missing_clauses,
    summarize_risk_profile,
)
from services.embedding_service import embedding_service
from services.security import validate_file_content, validate_safe_file_path


def _enrich_extraction_result(result: ExtractionResult, embed: bool) -> ExtractionResult:
    """Classify substantive clauses, flag missing protections, and attach embeddings."""
    if result.chunks:
        chunk_dicts = [chunk.model_dump() for chunk in result.chunks]
        classified = clause_service.process_chunks_into_clauses(chunk_dicts)
        missing = detect_missing_clauses(classified)

        result.classified_clauses = classified
        result.missing_clauses = missing
        result.risk_summary = summarize_risk_profile(classified, missing)

        clause_map = {item["clause_id"]: item for item in classified}
        for chunk in result.chunks:
            match = clause_map.get(chunk.chunk_id)
            if match:
                chunk.clause_type = match["clause_type"]
                chunk.risk_level = match["risk_level"]
                chunk.risk_reason = match["risk_reason"]

    if embed and result.chunks:
        embedding_service.embed_chunks(result.chunks)
        result.has_embeddings = True
        result.embedding_model = embedding_service.get_provider_name()

    return result


class ExtractionService:
    @staticmethod
    async def extract_from_upload(
        file: UploadFile,
        embed: bool = True,
        custom_name: Optional[str] = None,
    ) -> ExtractionResult:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")

        display_name = custom_name or file.filename
        try:
            content = await file.read()
            validate_file_content(content, file.filename)

            extractor = get_extractor(file.filename)
            result = extractor.extract_from_bytes(content, display_name)
            return _enrich_extraction_result(result, embed=embed)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract document '{display_name}': {err}",
            )

    @staticmethod
    def extract_from_path(
        file_path: str,
        custom_name: Optional[str] = None,
        embed: bool = True,
    ) -> ExtractionResult:
        resolved_path = validate_safe_file_path(file_path)
        display_name = custom_name or os.path.basename(str(resolved_path))
        try:
            with open(resolved_path, "rb") as handle:
                content = handle.read()

            validate_file_content(content, str(resolved_path))

            ext_to_use = os.path.splitext(str(resolved_path))[1]
            if not ext_to_use and custom_name:
                ext_to_use = os.path.splitext(custom_name)[1]
            if not ext_to_use:
                ext_to_use = os.path.basename(str(resolved_path))

            extractor = get_extractor(ext_to_use)
            result = extractor.extract_from_bytes(content, display_name)
            return _enrich_extraction_result(result, embed=embed)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract document '{display_name}': {err}",
            )
