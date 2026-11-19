from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from extractors import ExtractionResult
from services.analysis_service import analysis_service
from services.embedding_service import embedding_service
from services.extraction_service import ExtractionService
from services.health_service import get_health_status
from services.retrieval_service import retrieval_service
from services.vector_store import vector_store

app = FastAPI(
    title="Legal Contract Agent - AI Service",
    description="Document extraction, clause risk classification, summarization, contract comparison, and grounded RAG retrieval.",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractPathRequest(BaseModel):
    file_path: str = Field(..., description="Absolute or relative path to the contract file on disk")
    title: Optional[str] = Field(None, description="Optional document title or original filename")
    embed: bool = Field(True, description="Generate vector embeddings for extracted chunks")
    user_id: Optional[str] = Field(None, description="Owner user ID for vector indexing")
    document_id: Optional[str] = Field(None, description="Document ID for vector indexing")
    index_vector: bool = Field(False, description="Upsert extracted chunks into ChromaDB")


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., description="Strings to embed")
    task_type: str = Field("RETRIEVAL_DOCUMENT", description="Embedding task optimization hint")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimension: int
    count: int
    provider: str


class SimilarityRequest(BaseModel):
    text_a: str
    text_b: str


class VectorIndexRequest(BaseModel):
    user_id: str
    document_id: str
    chunks: List[Dict[str, Any]]


class VectorDeleteRequest(BaseModel):
    user_id: str
    document_id: Optional[str] = None


class RetrieveRequest(BaseModel):
    query: str
    user_id: str
    document_id: Optional[str] = None
    top_k: int = Field(5, ge=1, le=50)
    min_score: float = Field(0.25, ge=0.0, le=1.0)
    use_reranker: bool = True


class AnalyzeContractRequest(BaseModel):
    document_name: str = Field(..., description="Display name of the contract")
    full_text: str = Field(..., description="Extracted text of the contract")
    classified_clauses: List[Dict[str, Any]] = Field(default_factory=list)


class CompareContractsRequest(BaseModel):
    contract_a_title: str
    clauses_a: List[Dict[str, Any]]
    contract_b_title: str
    clauses_b: List[Dict[str, Any]]


@app.get("/", tags=["General"])
async def root():
    return {
        "status": "AI Service is running",
        "version": "1.2.0",
        "endpoints": {
            "health": "/health",
            "extract_file": "/api/v1/extract",
            "extract_path": "/api/v1/extract-path",
            "analyze": "/api/v1/analyze",
            "compare": "/api/v1/compare",
            "embed": "/api/v1/embed",
            "similarity": "/api/v1/similarity",
            "vector_index": "/api/v1/vector/index",
            "vector_delete": "/api/v1/vector/delete",
            "vector_stats": "/api/v1/vector/stats",
            "retrieve": "/api/v1/retrieve",
            "docs": "/docs",
        },
    }


@app.get("/health", tags=["Health"])
async def health():
    return get_health_status()


@app.post(
    "/api/v1/extract",
    response_model=ExtractionResult,
    status_code=status.HTTP_200_OK,
    tags=["Extraction"],
)
async def extract_document(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    embed: bool = Form(True),
):
    if file is not None and file.filename:
        return await ExtractionService.extract_from_upload(file, embed=embed)
    if file_path:
        return ExtractionService.extract_from_path(file_path, custom_name=title, embed=embed)
    raise HTTPException(
        status_code=400,
        detail="Either an uploaded 'file' or a 'file_path' parameter must be provided.",
    )


@app.post(
    "/api/v1/extract-path",
    response_model=ExtractionResult,
    status_code=status.HTTP_200_OK,
    tags=["Extraction"],
)
async def extract_from_local_path(payload: ExtractPathRequest):
    result = ExtractionService.extract_from_path(
        payload.file_path, custom_name=payload.title, embed=payload.embed
    )

    if payload.index_vector and payload.user_id and payload.document_id and result.chunks:
        chunk_dicts = [c.model_dump() for c in result.chunks]
        vector_store.upsert_chunks(payload.user_id, payload.document_id, chunk_dicts)

    return result


@app.post("/api/v1/analyze", status_code=status.HTTP_200_OK, tags=["Analysis"])
async def analyze_contract(payload: AnalyzeContractRequest):
    if not payload.full_text or not payload.full_text.strip():
        raise HTTPException(status_code=400, detail="Contract text cannot be empty.")

    return analysis_service.analyze_contract(
        document_name=payload.document_name,
        full_text=payload.full_text,
        classified_clauses=payload.classified_clauses,
    )


@app.post("/api/v1/compare", status_code=status.HTTP_200_OK, tags=["Analysis"])
async def compare_contracts(payload: CompareContractsRequest):
    if not payload.clauses_a and not payload.clauses_b:
        raise HTTPException(status_code=400, detail="Both contracts have no extracted clauses to compare.")

    return analysis_service.compare_contracts(
        contract_a_title=payload.contract_a_title,
        clauses_a=payload.clauses_a,
        contract_b_title=payload.contract_b_title,
        clauses_b=payload.clauses_b,
    )


@app.post(
    "/api/v1/embed",
    response_model=EmbedResponse,
    status_code=status.HTTP_200_OK,
    tags=["Embeddings"],
)
async def generate_embeddings(payload: EmbedRequest):
    if not payload.texts:
        raise HTTPException(status_code=400, detail="The 'texts' list cannot be empty.")

    vectors = embedding_service.embed_batch(payload.texts, task_type=payload.task_type)
    dim = len(vectors[0]) if vectors else embedding_service.dimension
    return EmbedResponse(
        embeddings=vectors,
        dimension=dim,
        count=len(vectors),
        provider=embedding_service.get_provider_name(),
    )


@app.post("/api/v1/similarity", status_code=status.HTTP_200_OK, tags=["Embeddings"])
async def calculate_similarity(payload: SimilarityRequest):
    vec_a, vec_b = embedding_service.embed_batch(
        [payload.text_a, payload.text_b], task_type="SEMANTIC_SIMILARITY"
    )
    sim = embedding_service.cosine_similarity(vec_a, vec_b)
    return {
        "similarity": sim,
        "text_a": payload.text_a,
        "text_b": payload.text_b,
        "provider": embedding_service.get_provider_name(),
    }


@app.post("/api/v1/vector/index", status_code=status.HTTP_200_OK, tags=["Vector Database"])
async def index_chunks(payload: VectorIndexRequest):
    if not payload.chunks:
        raise HTTPException(status_code=400, detail="Chunks list cannot be empty.")

    count = vector_store.upsert_chunks(
        user_id=payload.user_id,
        document_id=payload.document_id,
        chunks=payload.chunks,
    )
    return {
        "status": "success",
        "message": f"Indexed {count} chunks into vector store.",
        "user_id": payload.user_id,
        "document_id": payload.document_id,
        "indexed_count": count,
    }


@app.post("/api/v1/vector/delete", status_code=status.HTTP_200_OK, tags=["Vector Database"])
async def delete_vectors(payload: VectorDeleteRequest):
    if payload.document_id:
        deleted = vector_store.delete_by_document(payload.user_id, payload.document_id)
        msg = f"Removed {deleted} vectors for document '{payload.document_id}'."
    else:
        deleted = vector_store.delete_by_user(payload.user_id)
        msg = f"Removed {deleted} vectors for user '{payload.user_id}'."

    return {
        "status": "success",
        "message": msg,
        "deleted_count": deleted,
        "user_id": payload.user_id,
        "document_id": payload.document_id,
    }


@app.get("/api/v1/vector/stats", status_code=status.HTTP_200_OK, tags=["Vector Database"])
async def get_vector_stats(user_id: Optional[str] = Query(None)):
    stats = vector_store.stats()
    if user_id:
        stats["user_vectors"] = vector_store.count(user_id=user_id)
        stats["queried_user_id"] = user_id
    return stats


@app.post("/api/v1/retrieve", status_code=status.HTTP_200_OK, tags=["Retrieval & RAG"])
async def retrieve_passages(payload: RetrieveRequest):
    return retrieval_service.retrieve(
        query=payload.query,
        user_id=payload.user_id,
        document_id=payload.document_id,
        top_k=payload.top_k,
        min_score=payload.min_score,
        use_reranker=payload.use_reranker,
    )


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
