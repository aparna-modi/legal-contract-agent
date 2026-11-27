import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

load_dotenv()
logger = logging.getLogger(__name__)

from extractors import ExtractionResult
from services.analysis_service import analysis_service
from services.case_strategy_service import case_strategy_service
from services.docx_export_service import build_legal_docx
from services.drafting_service import drafting_service
from services.embedding_service import embedding_service
from services.extraction_service import ExtractionService
from services.health_service import get_health_status
from services.loophole_service import loophole_service
from services.playbook_service import playbook_service
from services.protective_rewrite_service import protective_rewrite_service
from services.retrieval_service import retrieval_service
from services.security import is_production, require_internal_auth
from services.vector_store import vector_store

_REQ_COUNTS: Dict[str, int] = {}
_LATENCY_SUM_MS = 0.0
_LATENCY_COUNT = 0

app = FastAPI(
    title="Legal Contract Agent - AI Service",
    version="3.0.0",
    docs_url=None if is_production() else "/docs",
    redoc_url=None if is_production() else "/redoc",
)

_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()] or [
    "http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:5173", "http://127.0.0.1:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Internal-Service-Key", "X-Request-Id"],
)


@app.middleware("http")
async def tracing_and_headers(request: Request, call_next):
    global _LATENCY_SUM_MS, _LATENCY_COUNT
    req_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    t0 = time.perf_counter()
    res = await call_next(request)
    ms = round((time.perf_counter() - t0) * 1000, 2)
    key = f"{request.method}:{request.url.path}:{res.status_code}"
    _REQ_COUNTS[key] = _REQ_COUNTS.get(key, 0) + 1
    _LATENCY_SUM_MS += ms
    _LATENCY_COUNT += 1
    res.headers.update({
        "X-Request-Id": req_id,
        "X-Process-Time-Ms": str(ms),
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-store",
    })
    return res


class ExtractPathRequest(BaseModel):
    file_path: str
    title: Optional[str] = None
    embed: bool = True
    user_id: Optional[str] = None
    document_id: Optional[str] = None
    index_vector: bool = False


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., max_length=200)
    task_type: str = "RETRIEVAL_DOCUMENT"


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimension: int
    count: int
    provider: str


class SimilarityRequest(BaseModel):
    text_a: str = Field(..., max_length=20_000)
    text_b: str = Field(..., max_length=20_000)


class VectorIndexRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    document_id: str = Field(..., min_length=1, max_length=128)
    chunks: List[Dict[str, Any]] = Field(..., max_length=1000)
    replace: bool = False


class VectorDeleteRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    document_id: Optional[str] = Field(default=None, max_length=128)


class RetrieveRequest(BaseModel):
    query: str = Field(..., max_length=1000)
    user_id: str = Field(..., min_length=1, max_length=128)
    document_id: Optional[str] = Field(default=None, max_length=128)
    document_title: Optional[str] = Field(default=None, max_length=240)
    top_k: int = Field(5, ge=1, le=50)
    min_score: float = Field(0.25, ge=0.0, le=1.0)
    use_reranker: bool = True
    fallback_chunks: Optional[List[Dict[str, Any]]] = None
    conversation_history: Optional[List[Dict[str, str]]] = None
    qa_mode: str = Field(default="facts", max_length=32)


class AnalyzeContractRequest(BaseModel):
    document_name: str = Field(..., min_length=1, max_length=240)
    full_text: str = Field(..., max_length=500_000)
    classified_clauses: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    user_party: str = Field(default="", max_length=160)
    user_role: str = Field(default="neutral", max_length=40)


class LoopholeAuditRequest(BaseModel):
    document_name: str = Field(default="Contract Draft", max_length=240)
    full_text: str = Field(..., min_length=20, max_length=500_000)
    classified_clauses: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    user_party: str = Field(default="", max_length=160)
    user_role: str = Field(default="neutral", max_length=40)
    mode: str = Field(default="full_audit", max_length=32)


class ApplyHardeningRequest(BaseModel):
    title: str = Field(default="Contract Draft", max_length=200)
    draft_text: str = Field(..., min_length=50, max_length=100_000)
    loopholes_to_fix: List[Dict[str, Any]] = Field(default_factory=list, max_length=30)
    jurisdiction: str = Field(default="India (Indian Contract Act, 1872)", max_length=160)


class ProtectiveRewriteRequest(BaseModel):
    document_name: str = Field(default="Contract", max_length=240)
    full_text: str = Field(..., min_length=30, max_length=500_000)
    classified_clauses: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    user_party: str = Field(default="", max_length=160)
    user_role: str = Field(default="client_buyer", max_length=40)
    aggressiveness: str = Field(default="maximum_user_only", max_length=40)
    jurisdiction: str = Field(default="India (Indian Contract Act, 1872)", max_length=160)
    custom_priorities: str = Field(default="", max_length=1500)


class CaseStrategyRequest(BaseModel):
    document_name: str = Field(default="Contract", max_length=240)
    full_text: str = Field(default="", max_length=500_000)
    classified_clauses: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    represented_party: str = Field(default="", max_length=160)
    user_role: str = Field(default="client_buyer", max_length=40)
    posture: str = Field(default="claimant", max_length=32)
    dispute_facts: str = Field(default="", max_length=3000)
    jurisdiction: str = Field(default="India", max_length=160)


class LegalNoticeRequest(BaseModel):
    document_name: str = Field(default="Commercial Agreement", max_length=240)
    parties: List[str] = Field(default_factory=list, max_length=8)
    effective_date: str = Field(default="", max_length=80)
    governing_law: str = Field(default="India", max_length=160)
    represented_party: str = Field(default="", max_length=160)
    counterparty_name: str = Field(default="", max_length=160)
    dispute_facts: str = Field(default="", max_length=3000)
    relief_sought: str = Field(default="", max_length=1000)
    notice_type: str = Field(default="demand_and_cure", max_length=60)
    breached_clauses_summary: str = Field(default="", max_length=2000)


class NegotiationEmailRequest(BaseModel):
    document_name: str = Field(default="Commercial Agreement", max_length=240)
    represented_party: str = Field(default="", max_length=160)
    counterparty_name: str = Field(default="", max_length=160)
    tone: str = Field(default="collaborative", max_length=32)
    deal_breakers: List[str] = Field(default_factory=list, max_length=10)
    negotiation_priorities: List[str] = Field(default_factory=list, max_length=10)
    accepted_redlines: List[Dict[str, str]] = Field(default_factory=list, max_length=12)
    custom_note: str = Field(default="", max_length=800)


class StandardizeBaselineRequest(BaseModel):
    title: str = Field(default="Commercial Agreement", max_length=200)
    draft_text: str = Field(..., min_length=50, max_length=100_000)
    jurisdiction: str = Field(default="India (Indian Contract Act, 1872)", max_length=160)
    contract_type: str = Field(default="msa", max_length=40)


class BenchmarkBaselineRequest(BaseModel):
    baseline_title: str = Field(..., min_length=1, max_length=200)
    baseline_text: str = Field(..., min_length=30, max_length=150_000)
    target_title: str = Field(..., min_length=1, max_length=200)
    target_text: str = Field(..., min_length=30, max_length=150_000)


class ExportDocxRequest(BaseModel):
    title: str = Field(default="Contract Agreement", max_length=240)
    full_text: str = Field(..., min_length=20, max_length=200_000)
    subtitle: str = Field(default="", max_length=200)
    jurisdiction: str = Field(default="", max_length=160)
    document_kind: str = Field(default="contract", max_length=40)
    counsel_notes: List[str] = Field(default_factory=list, max_length=20)
    disclaimer: str = Field(default="", max_length=500)


class CompareContractsRequest(BaseModel):
    contract_a_title: str = Field(..., min_length=1, max_length=240)
    clauses_a: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    contract_b_title: str = Field(..., min_length=1, max_length=240)
    clauses_b: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)


class RedlineRequest(BaseModel):
    clause_type: str = Field(..., min_length=1, max_length=120)
    clause_text: str = Field(..., min_length=1, max_length=10_000)
    risk_level: str = Field(default="high", max_length=20)
    risk_reason: str = Field(default="", max_length=1000)
    playbook_guidance: str = Field(default="", max_length=1000)
    stance: str = Field(default="balanced", max_length=32)
    custom_instruction: str = Field(default="", max_length=600)


class PlaybookEvaluateRequest(BaseModel):
    clauses: List[Dict[str, Any]] = Field(default_factory=list)
    missing_clauses: List[Dict[str, Any]] = Field(default_factory=list)
    key_facts: Dict[str, Any] = Field(default_factory=dict)
    rules: List[Dict[str, Any]] = Field(default_factory=list)
    use_ai_audit: bool = False


class GeneratePlaybookRulesRequest(BaseModel):
    policy_text: str = Field(..., min_length=10, max_length=3000)
    jurisdiction: str = Field(default="", max_length=160)


class DraftMissingClauseRequest(BaseModel):
    clause_type: str = Field(..., min_length=1, max_length=140)
    document_name: str = Field(default="Commercial Agreement", max_length=240)
    parties: List[str] = Field(default_factory=list, max_length=8)
    jurisdiction: str = Field(default="Not specified", max_length=160)
    reason: str = Field(default="", max_length=600)
    existing_summary: str = Field(default="", max_length=2000)


class DraftContractRequest(BaseModel):
    contract_type: str = Field(default="msa", max_length=40)
    title: str = Field(default="", max_length=180)
    party_a: str = Field(default="", max_length=160)
    party_b: str = Field(default="", max_length=160)
    jurisdiction: str = Field(default="India (Indian Contract Act, 1872)", max_length=160)
    effective_date: str = Field(default="", max_length=80)
    term_duration: str = Field(default="", max_length=120)
    payment_terms: str = Field(default="", max_length=400)
    notice_period: str = Field(default="", max_length=120)
    special_instructions: str = Field(default="", max_length=1500)
    stance: str = Field(default="balanced", max_length=40)
    representing_party: str = Field(default="mutual", max_length=32)
    template_details: Dict[str, str] = Field(default_factory=dict)


class ReviseDraftRequest(BaseModel):
    title: str = Field(default="Contract Draft", max_length=200)
    current_text: str = Field(..., min_length=50, max_length=60_000)
    instruction: str = Field(..., min_length=5, max_length=1500)
    jurisdiction: str = Field(default="India (Indian Contract Act, 1872)", max_length=160)


AUTH = [Depends(require_internal_auth)]


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "AI service encountered an unexpected error processing this request. Please retry.",
        },
    )


@app.get("/", tags=["General"])
async def root():
    return {
        "status": "AI Service is running",
        "version": "3.0.0",
        "endpoints": {
            "health": "/health", "live": "/health/live", "ready": "/health/ready",
            "extract_file": "/api/v1/extract", "extract_path": "/api/v1/extract-path",
            "analyze": "/api/v1/analyze", "compare": "/api/v1/compare",
            "embed": "/api/v1/embed", "similarity": "/api/v1/similarity",
            "vector_index": "/api/v1/vector/index", "vector_delete": "/api/v1/vector/delete",
            "vector_stats": "/api/v1/vector/stats", "retrieve": "/api/v1/retrieve",
            "redline": "/api/v1/redline", "playbook_evaluate": "/api/v1/playbook/evaluate",
            "playbook_generate_rules": "/api/v1/playbook/generate-rules",
            "negotiation_email": "/api/v1/negotiation/email",
            "draft": "/api/v1/draft", "draft_revise": "/api/v1/draft/revise",
            "draft_clause": "/api/v1/draft-clause", "draft_harden": "/api/v1/draft/harden",
            "draft_standardize_baseline": "/api/v1/draft/standardize-baseline",
            "baseline_benchmark": "/api/v1/baseline/benchmark",
            "loopholes_audit": "/api/v1/loopholes/audit",
            "rewrite_user_only": "/api/v1/contracts/rewrite-user-only",
            "counsel_case_strategy": "/api/v1/counsel/case-strategy",
            "counsel_legal_notice": "/api/v1/counsel/legal-notice",
            "export_docx": "/api/v1/export/docx",
        },
    }


@app.get("/health", tags=["Health"])
async def health():
    return get_health_status()


@app.get("/health/live", tags=["Health"])
async def health_live():
    return {"status": "alive", "service": "ai-service"}


@app.get("/health/ping", tags=["Health"])
async def health_ping():
    return {"status": "ok", "service": "ai-service"}


@app.get("/health/ready", tags=["Health"])
async def health_ready():
    s = get_health_status(include_vector_count=False)
    if not (s.get("embeddings_ready") and s.get("vector_store_ready")):
        raise HTTPException(status_code=503, detail="AI service dependencies are not ready.")
    return {
        "status": "ready",
        "embedding_provider": s["embedding_provider"],
        "llm_provider": s["llm_provider"],
        "vector_store_status": s["vector_store"]["status"],
    }


@app.post("/api/v1/extract", response_model=ExtractionResult, tags=["Extraction"], dependencies=AUTH)
async def extract_document(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    embed: bool = Form(True),
    user_id: Optional[str] = Form(None),
    document_id: Optional[str] = Form(None),
    index_vector: bool = Form(False),
):
    if file is not None and file.filename:
        result = await ExtractionService.extract_from_upload(file, embed=embed, custom_name=title)
    elif file_path:
        result = ExtractionService.extract_from_path(file_path, custom_name=title, embed=embed)
    else:
        raise HTTPException(
            status_code=400,
            detail="Either an uploaded 'file' or a 'file_path' parameter must be provided.",
        )

    if index_vector and user_id and document_id and result.chunks:
        vector_store.delete_by_document(user_id, document_id)
        vector_store.upsert_chunks(user_id, document_id, [c.model_dump() for c in result.chunks])
    return result


@app.post("/api/v1/extract-path", response_model=ExtractionResult, tags=["Extraction"], dependencies=AUTH)
async def extract_from_local_path(payload: ExtractPathRequest):
    result = ExtractionService.extract_from_path(payload.file_path, custom_name=payload.title, embed=payload.embed)
    if payload.index_vector and payload.user_id and payload.document_id and result.chunks:
        vector_store.delete_by_document(payload.user_id, payload.document_id)
        vector_store.upsert_chunks(payload.user_id, payload.document_id, [c.model_dump() for c in result.chunks])
    return result


@app.post("/api/v1/analyze", tags=["Analysis"], dependencies=AUTH)
async def analyze_contract(payload: AnalyzeContractRequest):
    if not payload.full_text.strip():
        raise HTTPException(status_code=400, detail="Contract text cannot be empty.")
    return analysis_service.analyze_contract(
        document_name=payload.document_name,
        full_text=payload.full_text,
        classified_clauses=payload.classified_clauses,
        user_party=payload.user_party,
        user_role=payload.user_role,
    )


@app.post("/api/v1/compare", tags=["Analysis"], dependencies=AUTH)
async def compare_contracts(payload: CompareContractsRequest):
    if not payload.clauses_a and not payload.clauses_b:
        raise HTTPException(status_code=400, detail="Both contracts have no extracted clauses to compare.")
    return analysis_service.compare_contracts(
        contract_a_title=payload.contract_a_title,
        clauses_a=payload.clauses_a,
        contract_b_title=payload.contract_b_title,
        clauses_b=payload.clauses_b,
    )


@app.post("/api/v1/embed", response_model=EmbedResponse, tags=["Embeddings"], dependencies=AUTH)
async def generate_embeddings(payload: EmbedRequest):
    if not payload.texts:
        raise HTTPException(status_code=400, detail="The 'texts' list cannot be empty.")
    vectors = embedding_service.embed_batch(payload.texts, task_type=payload.task_type)
    return EmbedResponse(
        embeddings=vectors,
        dimension=len(vectors[0]) if vectors else embedding_service.dimension,
        count=len(vectors),
        provider=embedding_service.get_provider_name(),
    )


@app.post("/api/v1/similarity", tags=["Embeddings"], dependencies=AUTH)
async def calculate_similarity(payload: SimilarityRequest):
    vec_a, vec_b = embedding_service.embed_batch([payload.text_a, payload.text_b], task_type="SEMANTIC_SIMILARITY")
    return {
        "similarity": embedding_service.cosine_similarity(vec_a, vec_b),
        "text_a": payload.text_a,
        "text_b": payload.text_b,
        "provider": embedding_service.get_provider_name(),
    }


@app.post("/api/v1/vector/index", tags=["Vector Database"], dependencies=AUTH)
async def index_chunks(payload: VectorIndexRequest):
    if not payload.chunks:
        raise HTTPException(status_code=400, detail="Chunks list cannot be empty.")
    if payload.replace:
        vector_store.delete_by_document(payload.user_id, payload.document_id)
    count = vector_store.upsert_chunks(user_id=payload.user_id, document_id=payload.document_id, chunks=payload.chunks)
    return {
        "status": "success",
        "message": f"Indexed {count} chunks into vector store.",
        "user_id": payload.user_id,
        "document_id": payload.document_id,
        "indexed_count": count,
    }


@app.post("/api/v1/vector/delete", tags=["Vector Database"], dependencies=AUTH)
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


@app.get("/api/v1/vector/stats", tags=["Vector Database"], dependencies=AUTH)
async def get_vector_stats(user_id: Optional[str] = Query(None)):
    stats = vector_store.stats()
    if user_id:
        stats["user_vectors"] = vector_store.count(user_id=user_id)
        stats["queried_user_id"] = user_id
    return stats


@app.post("/api/v1/retrieve", tags=["Retrieval & RAG"], dependencies=AUTH)
async def retrieve_passages(payload: RetrieveRequest):
    return retrieval_service.retrieve(
        query=payload.query,
        user_id=payload.user_id,
        document_id=payload.document_id,
        document_title=payload.document_title,
        top_k=payload.top_k,
        min_score=payload.min_score,
        use_reranker=payload.use_reranker,
        fallback_chunks=payload.fallback_chunks,
        conversation_history=payload.conversation_history,
        qa_mode=payload.qa_mode,
    )


@app.post("/api/v1/redline", tags=["Playbook & Redline"], dependencies=AUTH)
async def suggest_redline(payload: RedlineRequest):
    if not payload.clause_text.strip():
        raise HTTPException(status_code=400, detail="Clause text is required.")
    return playbook_service.suggest_redline(
        clause_type=payload.clause_type,
        clause_text=payload.clause_text,
        risk_level=payload.risk_level,
        risk_reason=payload.risk_reason,
        playbook_guidance=payload.playbook_guidance,
        stance=payload.stance,
        custom_instruction=payload.custom_instruction,
    )


@app.post("/api/v1/playbook/evaluate", tags=["Playbook & Redline"], dependencies=AUTH)
async def evaluate_playbook(payload: PlaybookEvaluateRequest):
    return playbook_service.evaluate_playbook(
        clauses=payload.clauses,
        missing_clauses=payload.missing_clauses,
        key_facts=payload.key_facts,
        rules=payload.rules,
        use_ai_audit=payload.use_ai_audit,
    )


@app.post("/api/v1/playbook/generate-rules", tags=["Playbook & Redline"], dependencies=AUTH)
async def generate_playbook_rules(payload: GeneratePlaybookRulesRequest):
    return playbook_service.generate_rules_from_policy(
        policy_text=payload.policy_text,
        jurisdiction=payload.jurisdiction,
    )


@app.post("/api/v1/draft-clause", tags=["Drafting"], dependencies=AUTH)
async def draft_missing_clause(payload: DraftMissingClauseRequest):
    return analysis_service.draft_missing_clause(
        clause_type=payload.clause_type,
        document_name=payload.document_name,
        parties=payload.parties,
        jurisdiction=payload.jurisdiction,
        reason=payload.reason,
        existing_summary=payload.existing_summary,
    )


@app.get("/api/v1/draft/templates", tags=["Drafting"], dependencies=AUTH)
async def list_draft_templates():
    return {"templates": drafting_service.list_templates()}


@app.post("/api/v1/draft", tags=["Drafting"], dependencies=AUTH)
async def draft_contract(payload: DraftContractRequest):
    return drafting_service.generate_draft(
        contract_type=payload.contract_type,
        title=payload.title,
        party_a=payload.party_a,
        party_b=payload.party_b,
        jurisdiction=payload.jurisdiction,
        effective_date=payload.effective_date,
        term_duration=payload.term_duration,
        payment_terms=payload.payment_terms,
        notice_period=payload.notice_period,
        special_instructions=payload.special_instructions,
        stance=payload.stance,
        representing_party=payload.representing_party,
        template_details=payload.template_details,
    )


@app.post("/api/v1/draft/revise", tags=["Drafting"], dependencies=AUTH)
async def revise_contract_draft(payload: ReviseDraftRequest):
    return drafting_service.revise_draft(
        title=payload.title,
        current_text=payload.current_text,
        instruction=payload.instruction,
        jurisdiction=payload.jurisdiction,
    )


@app.post("/api/v1/loopholes/audit", tags=["Loopholes & Hardening"], dependencies=AUTH)
async def audit_loopholes(payload: LoopholeAuditRequest):
    return loophole_service.audit_loopholes(
        document_name=payload.document_name,
        full_text=payload.full_text,
        classified_clauses=payload.classified_clauses,
        user_role=payload.user_role,
        user_party=payload.user_party,
        mode=payload.mode,
    )


@app.post("/api/v1/draft/harden", tags=["Loopholes & Hardening"], dependencies=AUTH)
async def harden_initial_draft(payload: ApplyHardeningRequest):
    return loophole_service.apply_hardening_resolutions(
        title=payload.title,
        draft_text=payload.draft_text,
        loopholes_to_fix=payload.loopholes_to_fix,
        jurisdiction=payload.jurisdiction,
    )


@app.post("/api/v1/draft/standardize-baseline", tags=["Baselines"], dependencies=AUTH)
async def standardize_baseline(payload: StandardizeBaselineRequest):
    return drafting_service.standardize_presentation_baseline(
        title=payload.title,
        draft_text=payload.draft_text,
        jurisdiction=payload.jurisdiction,
        contract_type=payload.contract_type,
    )


@app.post("/api/v1/baseline/benchmark", tags=["Baselines"], dependencies=AUTH)
async def benchmark_baseline(payload: BenchmarkBaselineRequest):
    return drafting_service.benchmark_against_baseline(
        baseline_title=payload.baseline_title,
        baseline_text=payload.baseline_text,
        target_title=payload.target_title,
        target_text=payload.target_text,
    )


@app.post("/api/v1/contracts/rewrite-user-only", tags=["Protective Rewrite"], dependencies=AUTH)
async def rewrite_contract_for_user(payload: ProtectiveRewriteRequest):
    return protective_rewrite_service.rewrite_for_user(
        document_name=payload.document_name,
        full_text=payload.full_text,
        classified_clauses=payload.classified_clauses,
        user_party=payload.user_party,
        user_role=payload.user_role,
        aggressiveness=payload.aggressiveness,
        jurisdiction=payload.jurisdiction,
        custom_priorities=payload.custom_priorities,
    )


@app.post("/api/v1/counsel/case-strategy", tags=["Counsel Strategy"], dependencies=AUTH)
async def generate_case_strategy(payload: CaseStrategyRequest):
    return case_strategy_service.build_case_strategy(
        document_name=payload.document_name,
        full_text=payload.full_text,
        classified_clauses=payload.classified_clauses,
        represented_party=payload.represented_party,
        user_role=payload.user_role,
        posture=payload.posture,
        dispute_facts=payload.dispute_facts,
        jurisdiction=payload.jurisdiction,
    )


@app.post("/api/v1/counsel/legal-notice", tags=["Counsel Strategy"], dependencies=AUTH)
async def draft_legal_notice(payload: LegalNoticeRequest):
    return case_strategy_service.draft_legal_notice(
        document_name=payload.document_name,
        parties=payload.parties,
        effective_date=payload.effective_date,
        governing_law=payload.governing_law,
        represented_party=payload.represented_party,
        counterparty_name=payload.counterparty_name,
        dispute_facts=payload.dispute_facts,
        relief_sought=payload.relief_sought,
        notice_type=payload.notice_type,
        breached_clauses_summary=payload.breached_clauses_summary,
    )


@app.post("/api/v1/negotiation/email", tags=["Playbook & Redline"], dependencies=AUTH)
async def draft_negotiation_email(payload: NegotiationEmailRequest):
    return playbook_service.generate_negotiation_email(
        document_name=payload.document_name,
        represented_party=payload.represented_party,
        counterparty_name=payload.counterparty_name,
        tone=payload.tone,
        deal_breakers=payload.deal_breakers,
        negotiation_priorities=payload.negotiation_priorities,
        accepted_redlines=payload.accepted_redlines,
        custom_note=payload.custom_note,
    )


@app.post("/api/v1/export/docx", tags=["Export"], dependencies=AUTH)
async def export_docx(payload: ExportDocxRequest):
    docx_bytes = build_legal_docx(
        title=payload.title,
        full_text=payload.full_text,
        subtitle=payload.subtitle,
        jurisdiction=payload.jurisdiction,
        document_kind=payload.document_kind,
        counsel_notes=payload.counsel_notes,
        disclaimer=payload.disclaimer,
    )
    safe_name = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (payload.title or "contract"))[:60].strip("_") or "contract"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.docx"'},
    )


@app.get("/metrics", response_class=PlainTextResponse, tags=["Observability"], dependencies=AUTH)
async def prometheus_metrics():
    avg_ms = round(_LATENCY_SUM_MS / _LATENCY_COUNT, 2) if _LATENCY_COUNT else 0.0
    lines = ["# HELP ai_http_requests_total Total HTTP requests handled by AI service", "# TYPE ai_http_requests_total counter"]
    for key, count in sorted(_REQ_COUNTS.items()):
        method, path, code = key.split(":", 2)
        lines.append(f'ai_http_requests_total{{method="{method}",path="{path}",status="{code}"}} {count}')
    lines.extend([
        "# HELP ai_http_request_duration_ms_avg Average HTTP request latency in milliseconds",
        "# TYPE ai_http_request_duration_ms_avg gauge",
        f"ai_http_request_duration_ms_avg {avg_ms}",
        "# HELP ai_vector_store_total Total indexed vectors in active store",
        "# TYPE ai_vector_store_total gauge",
        f"ai_vector_store_total {vector_store.count()}",
    ])
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=not is_production())
