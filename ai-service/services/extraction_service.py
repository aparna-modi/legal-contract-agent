import os
from typing import Optional
from fastapi import HTTPException, UploadFile

from extractors import ExtractionResult, get_extractor
from services.embedding_service import embedding_service
from services.clause_service import clause_service


class ExtractionService:
    @staticmethod
    async def extract_from_upload(file: UploadFile, embed: bool = True) -> ExtractionResult:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")

        try:
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail="Uploaded file is empty.")

            extractor = get_extractor(file.filename)
            result = extractor.extract_from_bytes(content, file.filename)

            # Run intelligent legal clause classification & risk assessment
            if result.chunks:
                chunk_dicts = [c.model_dump() for c in result.chunks]
                classified = clause_service.process_chunks_into_clauses(chunk_dicts)
                result.classified_clauses = classified

                # Map back to chunk objects
                clause_map = {c["clause_id"]: c for c in classified}
                for c in result.chunks:
                    cid = c.chunk_id
                    if cid in clause_map:
                        c.clause_type = clause_map[cid]["clause_type"]
                        c.risk_level = clause_map[cid]["risk_level"]
                        c.risk_reason = clause_map[cid]["risk_reason"]

            if embed and result.chunks:
                embedding_service.embed_chunks(result.chunks)
                result.has_embeddings = True
                result.embedding_model = embedding_service.get_provider_name()

            return result
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to extract document '{file.filename}': {str(e)}"
            )

    @staticmethod
    def extract_from_path(
        file_path: str, custom_name: Optional[str] = None, embed: bool = True
    ) -> ExtractionResult:
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found on server: '{file_path}'")

        display_name = custom_name or os.path.basename(file_path)
        try:
            with open(file_path, "rb") as f:
                content = f.read()

            if not content:
                raise HTTPException(status_code=400, detail=f"File '{display_name}' is empty.")

            # Identify extractor from file_path extension first, then fallback to custom_name
            ext_to_use = os.path.splitext(file_path)[1]
            if not ext_to_use and custom_name:
                ext_to_use = os.path.splitext(custom_name)[1]
            if not ext_to_use:
                ext_to_use = os.path.basename(file_path)

            extractor = get_extractor(ext_to_use)
            result = extractor.extract_from_bytes(content, display_name)

            # Run intelligent legal clause classification & risk assessment
            if result.chunks:
                chunk_dicts = [c.model_dump() for c in result.chunks]
                classified = clause_service.process_chunks_into_clauses(chunk_dicts)
                result.classified_clauses = classified

                # Map back to chunk objects
                clause_map = {c["clause_id"]: c for c in classified}
                for c in result.chunks:
                    cid = c.chunk_id
                    if cid in clause_map:
                        c.clause_type = clause_map[cid]["clause_type"]
                        c.risk_level = clause_map[cid]["risk_level"]
                        c.risk_reason = clause_map[cid]["risk_reason"]

            if embed and result.chunks:
                embedding_service.embed_chunks(result.chunks)
                result.has_embeddings = True
                result.embedding_model = embedding_service.get_provider_name()

            return result
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to extract document '{display_name}': {str(e)}"
            )
