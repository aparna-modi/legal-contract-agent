from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from extractors import ExtractionResult
from services.extraction_service import ExtractionService
from services.health_service import get_health_status
from services.vector_store import vector_store
from services.retrieval_service import retrieval_service

app = FastAPI(
    title="Legal Contract Agent - AI Ingestion & Retrieval Service",
    description="Multi-format contract ingestion, legal-aware chunking, vector database index, and grounded retrieval pipeline.",
    version="1.1.0",
)

# Enable CORS for internal microservice communication and web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractPathRequest(BaseModel):
    file_path: str = Field(..., description="Absolute or relative path to the contract file on disk")
    title: Optional[str] = Field(None, description="Optional custom title or original filename")
    embed: bool = Field(True, description="Whether to generate dense vector embeddings for chunks")
    user_id: Optional[str] = Field(None, description="Optional user ID for immediate vector indexing")
    document_id: Optional[str] = Field(None, description="Optional document ID for immediate vector indexing")
    index_vector: bool = Field(False, description="Automatically index extracted chunks into ChromaDB")


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., description="List of text strings to generate vector embeddings for")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimension: int
    count: int
    provider: str


class SimilarityRequest(BaseModel):
    text_a: str = Field(..., description="First text string")
    text_b: str = Field(..., description="Second text string")


class VectorIndexRequest(BaseModel):
    user_id: str = Field(..., description="Authenticated user ID for tenant isolation")
    document_id: str = Field(..., description="Target document ID")
    chunks: List[Dict[str, Any]] = Field(..., description="List of chunk dictionaries to index")


class VectorDeleteRequest(BaseModel):
    user_id: str = Field(..., description="Authenticated user ID for tenant isolation")
    document_id: Optional[str] = Field(None, description="Specific document ID to purge (omit to purge user's all vectors)")


class RetrieveRequest(BaseModel):
    query: str = Field(..., description="Question or search query regarding the contract")
    user_id: str = Field(..., description="Authenticated user ID for tenant isolation")
    document_id: Optional[str] = Field(None, description="Specific document ID to query, or omit for library-wide search")
    top_k: int = Field(5, ge=1, le=50, description="Maximum number of candidate passages to return")
    min_score: float = Field(0.25, ge=0.0, le=1.0, description="Minimum relevance threshold before returning insufficient information")
    use_reranker: bool = Field(True, description="Whether to apply legal cross-clause reranker")


@app.get("/", tags=["General"])
async def root():
    return {
        "status": "AI Ingestion, Vector Index & Retrieval Service is running",
        "version": "1.1.0",
        "endpoints": {
            "health": "/health",
            "extract_file": "/api/v1/extract (POST multipart/form-data)",
            "extract_path": "/api/v1/extract-path (POST application/json)",
            "embed": "/api/v1/embed (POST application/json)",
            "similarity": "/api/v1/similarity (POST application/json)",
            "vector_index": "/api/v1/vector/index (POST application/json)",
            "vector_delete": "/api/v1/vector/delete (POST application/json)",
            "vector_stats": "/api/v1/vector/stats (GET)",
            "retrieve": "/api/v1/retrieve (POST application/json)",
            "docs": "/docs",
        },
    }



@app.get("/health", tags=["Health & Readiness"])
async def health():
    """
    Health & Readiness Check:
    Returns system memory telemetry, CPU usage, GPU status, document extractor readiness,
    and active embedding vectorizer.
    """
    return get_health_status()


@app.post(
    "/api/v1/extract",
    response_model=ExtractionResult,
    status_code=status.HTTP_200_OK,
    tags=["Extraction"],
    summary="Extract structured text and chunks from an uploaded file or file path",
)
async def extract_document(
    file: Optional[UploadFile] = File(None, description="Contract document file (.pdf, .docx, .txt)"),
    file_path: Optional[str] = Form(None, description="Optional path to existing file on server"),
    title: Optional[str] = Form(None, description="Optional title or original filename"),
    embed: bool = Form(True, description="Whether to generate vector embeddings for extracted chunks"),
):
    """
    Document Ingestion Endpoint:
    Accepts raw PDF, DOCX, or TXT file as a multipart upload, or a server file_path.
    Extracts text, preserves layout & headings, and returns structured chunks with character offsets.
    """
    if file is not None and file.filename:
        return await ExtractionService.extract_from_upload(file, embed=embed)
    elif file_path:
        return ExtractionService.extract_from_path(file_path, custom_name=title, embed=embed)
    else:
        raise HTTPException(
            status_code=400,
            detail="Either an uploaded 'file' or a 'file_path' parameter must be provided.",
        )


@app.post(
    "/api/v1/extract-path",
    response_model=ExtractionResult,
    status_code=status.HTTP_200_OK,
    tags=["Extraction"],
    summary="Extract structured text and chunks from a local file path (JSON payload)",
)
async def extract_from_local_path(payload: ExtractPathRequest):
    """
    Document Ingestion via File Path:
    Designed for seamless integration with the Express backend which saves uploaded files to disk.
    Optionally indexes vectors directly into ChromaDB when user_id and document_id are supplied.
    """
    result = ExtractionService.extract_from_path(
        payload.file_path, custom_name=payload.title, embed=payload.embed
    )

    if payload.index_vector and payload.user_id and payload.document_id and result.chunks:
        chunk_dicts = [c.model_dump() for c in result.chunks]
        vector_store.upsert_chunks(payload.user_id, payload.document_id, chunk_dicts)

    return result


@app.post(
    "/api/v1/embed",
    response_model=EmbedResponse,
    status_code=status.HTTP_200_OK,
    tags=["Embeddings"],
    summary="Generate dense vector embeddings for an array of texts",
)
async def generate_embeddings(payload: EmbedRequest):
    """
    Vector Embedding Generation Endpoint:
    Converts list of text strings into normalized vector embeddings.
    """
    from services.embedding_service import embedding_service

    if not payload.texts:
        raise HTTPException(status_code=400, detail="The 'texts' list cannot be empty.")

    vectors = embedding_service.embed_batch(payload.texts)
    dim = len(vectors[0]) if vectors else embedding_service.dimension
    return EmbedResponse(
        embeddings=vectors,
        dimension=dim,
        count=len(vectors),
        provider=embedding_service.get_provider_name(),
    )


@app.post(
    "/api/v1/similarity",
    status_code=status.HTTP_200_OK,
    tags=["Embeddings"],
    summary="Calculate semantic cosine similarity between two texts",
)
async def calculate_similarity(payload: SimilarityRequest):
    """
    Cosine Similarity Helper Endpoint:
    Calculates semantic cosine similarity between two legal clauses or queries.
    """
    from services.embedding_service import embedding_service

    vec_a = embedding_service.embed_text(payload.text_a)
    vec_b = embedding_service.embed_text(payload.text_b)
    sim = embedding_service.cosine_similarity(vec_a, vec_b)
    return {
        "similarity": sim,
        "text_a": payload.text_a,
        "text_b": payload.text_b,
        "provider": embedding_service.get_provider_name(),
    }


@app.post(
    "/api/v1/vector/index",
    status_code=status.HTTP_200_OK,
    tags=["Vector Database"],
    summary="Index contract chunks into ChromaDB with multi-tenant user scoping",
)
async def index_chunks(payload: VectorIndexRequest):
    """
    Vector Indexing Endpoint:
    Stores dense vector embeddings with complete chunk metadata (page, section, clause)
    and strictly enforces user_id isolation.
    """
    if not payload.chunks:
        raise HTTPException(status_code=400, detail="Chunks list cannot be empty.")

    count = vector_store.upsert_chunks(
        user_id=payload.user_id,
        document_id=payload.document_id,
        chunks=payload.chunks,
    )
    return {
        "status": "success",
        "message": f"Successfully indexed {count} chunks into vector store.",
        "user_id": payload.user_id,
        "document_id": payload.document_id,
        "indexed_count": count,
    }


@app.post(
    "/api/v1/vector/delete",
    status_code=status.HTTP_200_OK,
    tags=["Vector Database"],
    summary="Purge contract vectors from ChromaDB for a document or user",
)
async def delete_vectors(payload: VectorDeleteRequest):
    """
    Vector Deletion Endpoint:
    Synchronizes document deletion from MongoDB/disk with ChromaDB index.
    """
    if payload.document_id:
        deleted = vector_store.delete_by_document(payload.user_id, payload.document_id)
        msg = f"Purged {deleted} vectors for document '{payload.document_id}'."
    else:
        deleted = vector_store.delete_by_user(payload.user_id)
        msg = f"Purged {deleted} vectors for user '{payload.user_id}'."

    return {
        "status": "success",
        "message": msg,
        "deleted_count": deleted,
        "user_id": payload.user_id,
        "document_id": payload.document_id,
    }


@app.get(
    "/api/v1/vector/stats",
    status_code=status.HTTP_200_OK,
    tags=["Vector Database"],
    summary="Retrieve vector store index statistics and health telemetry",
)
async def get_vector_stats(user_id: Optional[str] = Query(None, description="Optional user ID to filter count")):
    """
    Vector Telemetry Endpoint:
    Returns vector collection stats, storage directory, and optional user vector counts.
    """
    stats = vector_store.stats()
    if user_id:
        stats["user_vectors"] = vector_store.count(user_id=user_id)
        stats["queried_user_id"] = user_id
    return stats


@app.post(
    "/api/v1/retrieve",
    status_code=status.HTTP_200_OK,
    tags=["Retrieval & RAG"],
    summary="Execute grounded semantic retrieval with hybrid legal reranking and citations",
)
async def retrieve_passages(payload: RetrieveRequest):
    """
    Grounded Retrieval Pipeline Endpoint:
    1. Embeds query with domain vectorizer
    2. Executes multi-tenant vector similarity search
    3. Re-ranks candidates using legal concept weighting & heading alignment
    4. Evaluates verification threshold to prevent hallucination
    5. Returns cited passages with page, section, confidence score, and grounded answer
    """
    response = retrieval_service.retrieve(
        query=payload.query,
        user_id=payload.user_id,
        document_id=payload.document_id,
        top_k=payload.top_k,
        min_score=payload.min_score,
        use_reranker=payload.use_reranker,
    )
    return response


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

