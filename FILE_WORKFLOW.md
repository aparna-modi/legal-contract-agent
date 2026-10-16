# Complete File-by-File Workflow & System Reference Guide
## Legal Contract Intelligence & Retrieval Platform

---

## Executive Summary & Architecture

The **Legal Contract Intelligence & Retrieval Platform** is an enterprise-grade full-stack microservices application designed for legal document ingestion, automated clause classification, risk identification, semantic vectorization, and grounded RAG (Retrieval-Augmented Generation) contract Q&A.

```mermaid
flowchart TD
    subgraph Client Tier [Frontend: React 19 + Vite | Port 5173]
        A1[main.jsx] --> A2[App.jsx]
        A2 --> A3[AuthContext.jsx]
        A3 --> A4[Login.jsx / Register.jsx]
        A3 --> A5[UploadScreen.jsx]
        A3 --> A6[Dashboard.jsx]
        A4 & A5 & A6 --> A7[config/api.js]
    end

    subgraph Gateway Tier [Backend: Express 5 + Node 20 | Port 5000]
        B1[server.js] --> B2[config/db.js]
        B1 --> B3[middleware/authMiddleware.js]
        B1 --> B4[routes/authRoutes.js]
        B1 --> B5[routes/contractRoutes.js]
        B4 --> B6[(User.js Mongoose Model)]
        B5 --> B7[(Document.js Mongoose Model)]
        B5 --> B8[(Clause.js Mongoose Model)]
        B5 --> B9[Local File Storage /uploads/]
    end

    subgraph Intelligence Tier [AI Service: FastAPI + Python 3.13 | Port 8000]
        C1[main.py] --> C2[services/extraction_service.py]
        C2 --> C3[extractors/__init__.py]
        C3 --> C4[extractors/pdf_extractor.py]
        C3 --> C5[extractors/docx_extractor.py]
        C3 --> C6[extractors/txt_extractor.py]
        C2 --> C7[services/clause_service.py]
        C2 --> C8[services/embedding_service.py]
        C1 --> C9[services/vector_store.py]
        C1 --> C10[services/retrieval_service.py]
        C10 --> C11[services/embedding_service.py]
        C10 --> C9
        C10 --> C12[Google Gemini 2.5 Flash / Extractive Fallback]
    end

    A7 -->|"REST + JWT"| B1
    B5 -->|"HTTP JSON /api/v1/*"| C1
```

---

## Runtime Workflow in Execution Sequence

### Workflow 1: Authentication Lifecycle (Register / Login)
1. **User Action**: Enters name, email, password on `Register.jsx` or `Login.jsx`.
2. **Frontend Call**: Sends `POST http://localhost:5000/api/auth/register` or `/login`.
3. **Backend Middleware**: `server.js` routes to `routes/authRoutes.js`.
4. **Data Layer**:
   - `User.js` queries MongoDB.
   - `bcryptjs` hashes or verifies the password with 10 salt rounds.
   - `jsonwebtoken` signs a JWT containing `{ userId }` with a 7-day expiration.
5. **State Synchronization**: `AuthContext.jsx` saves `{ token, user }` to `localStorage` and React context state.

### Workflow 2: Contract Upload & Disk Ingestion
1. **User Action**: Drags and drops `.pdf`, `.docx`, or `.txt` into `UploadScreen.jsx`.
2. **Frontend Call**: Sends multipart `FormData` via `POST /api/contracts/upload` with `Authorization: Bearer <token>`.
3. **Backend Middleware**:
   - `authMiddleware.js` verifies the JWT and attaches `req.user`.
   - `multer` validates file size (<10MB) and extension, writes the file to `backend/uploads/`.
4. **Data Layer**: `Document.js` creates a record with `status: "uploaded"`.
5. **UI Return**: Redirects user to `Dashboard.jsx`.

### Workflow 3: Document Extraction, Legal Chunking & ChromaDB Vectorization
1. **User Action**: Clicks **"Extract & Vector Index"** on `Dashboard.jsx`.
2. **Backend Gateway**: `routes/contractRoutes.js` (`POST /:id/extract`) reads the file path from MongoDB, verifies disk presence, and sends `POST http://localhost:8000/api/v1/extract-path` to FastAPI.
3. **FastAPI Coordinator**: `main.py` dispatches to `ExtractionService.extract_from_path()`.
4. **Format-Aware Parsing**:
   - `extractors/__init__.py` chooses `PDFDocumentExtractor`, `DOCXDocumentExtractor`, or `TXTDocumentExtractor`.
   - `extractors/utils.py` cleans text and identifies section headings (`is_heading`).
   - Chunks are assembled preserving structural boundaries and page numbers.
5. **Taxonomy & Risk Classification**:
   - `services/clause_service.py` runs legal regex patterns to classify clauses (`Termination`, `Indemnity`, `Liability`, etc.) and assigns risk levels (`HIGH`, `MEDIUM`, `LOW`).
6. **Vectorization**:
   - `services/embedding_service.py` converts each chunk into a 384-dimensional normalized dense vector.
7. **Vector Indexing**:
   - `services/vector_store.py` upserts chunks into ChromaDB (`legal_contracts` collection) with tenant filtering metadata (`user_id`, `document_id`, `page_number`, `clause_type`).
8. **Relational Persistence**:
   - Express receives the extracted chunks and saves them in MongoDB using `Clause.js`.
   - Updates `Document.js` with `status: "completed"`, `pageCount`, and `vectorCount`.
9. **UI Update**: `Dashboard.jsx` refreshes badges to **"Indexed"** with clause counts.

### Workflow 4: Grounded Contract Q&A (RAG Pipeline)
1. **User Action**: Types a question into the contract Q&A modal on `Dashboard.jsx`.
2. **Backend Proxy**: `routes/contractRoutes.js` (`POST /:id/ask`) calls FastAPI `POST /api/v1/retrieve`.
3. **Query Embedding**: `services/retrieval_service.py` embeds the question via `EmbeddingService`.
4. **Isolated Vector Lookup**: `services/vector_store.py` queries ChromaDB with metadata filter `{"user_id": userId, "document_id": documentId}` for top-15 candidates.
5. **Hybrid Legal Re-Ranking**:
   - `LegalReranker` computes composite score:
     $$\text{Score} = 0.50 \cdot S_{\text{dense}} + 0.25 \cdot S_{\text{lexical}} + 0.10 \cdot B_{\text{legal\_term}} + 0.10 \cdot B_{\text{heading}} + 0.05 \cdot B_{\text{phrase}}$$
6. **Hallucination Defense**:
   - If top score < `min_score` (`0.25`), the query is flagged as `insufficient_information: True`, refusing to hallucinate an answer.
7. **Synthesis**:
   - If score is verified, calls Google Gemini 2.5 Flash via `httpx` with strict grounding prompts, citing exact clause and page numbers.
8. **UI Display**: `Dashboard.jsx` displays the answer with confidence indicators and source badges.

### Workflow 5: Library-Wide Cross-Contract Comparison
1. **User Action**: Types a concept into the top global search bar on `Dashboard.jsx`.
2. **Backend Call**: `routes/contractRoutes.js` (`POST /api/contracts/search`) calls FastAPI `POST /api/v1/retrieve` without `document_id`.
3. **Cross-Document Retrieval**: ChromaDB searches across all documents belonging to that `user_id`.
4. **Relational Join**: Express joins ChromaDB results with MongoDB `Document.js` titles.
5. **Comparison Presentation**: Displays matching clauses from multiple contracts side-by-side.

---

## Detailed File-by-File Breakdown

### 1. Frontend Client Tier (`frontend/`)

#### `frontend/src/main.jsx`
- **Purpose**: Application root mounting file.
- **Key Functions**: Mounts React 19 Virtual DOM into `document.getElementById('root')` wrapped in `BrowserRouter` and `AuthProvider`.
- **Connections**: Imports `App.jsx`, `AuthContext.jsx`, `index.css`.

#### `frontend/src/App.jsx`
- **Purpose**: Primary layout shell and client-side routing controller.
- **Key Functions**:
  - `App()`: Renders global navigation bar, brand logo, user profile status, and routes.
  - `handleLogout()`: Triggers session termination and redirects to `/login`.
- **Routes Managed**:
  - `/` &rarr; `<Dashboard />`
  - `/upload` &rarr; `<UploadScreen />`
  - `/login` &rarr; `<Login />`
  - `/register` &rarr; `<Register />`
- **Connections**: Consumes `AuthContext.jsx` for auth state; renders page views.

#### `frontend/src/config/api.js`
- **Purpose**: Single source of truth for the API Gateway base URL.
- **Content**:
  ```javascript
  export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
  ```
- **Connections**: Imported by all frontend pages to ensure no port mismatch occurs.

#### `frontend/src/context/AuthContext.jsx`
- **Purpose**: Global authentication state manager.
- **Key Functions**:
  - `AuthProvider({ children })`: Initializes auth state from `localStorage` (`jwt` and `user`).
  - `login(userData, jwtToken)`: Saves credentials to state and `localStorage`.
  - `logout()`: Clears credentials and invalidates active session.
  - `useAuth()`: Custom hook exposing `{ user, token, login, logout, isAuthenticated }`.
- **Connections**: Used by `App.jsx`, `Dashboard.jsx`, `UploadScreen.jsx`, `Login.jsx`, `Register.jsx`.

#### `frontend/src/pages/Login.jsx`
- **Purpose**: User authentication interface.
- **Key Functions**:
  - `handleSubmit(e)`: Sends `POST /api/auth/login` with `{ email, password }`.
  - On success, invokes `login()` from `AuthContext` and navigates to `/`.
- **Connections**: Calls `authRoutes.js` on port 5000 via `api.js`.

#### `frontend/src/pages/Register.jsx`
- **Purpose**: New user account creation interface.
- **Key Functions**:
  - `handleSubmit(e)`: Validates password length (>= 6 chars), sends `POST /api/auth/register`.
  - On success, stores token and redirects to `/`.
- **Connections**: Calls `authRoutes.js` on port 5000 via `api.js`.

#### `frontend/src/pages/UploadScreen.jsx`
- **Purpose**: Secure contract file ingestion interface.
- **Key Functions**:
  - `validateAndSetFile(file)`: Enforces extension whitelist (`.pdf`, `.docx`, `.txt`) and 10MB size limit.
  - `handleDragOver()`, `handleDrop()`: Drag-and-drop file upload handlers.
  - `handleSubmit(e)`: Creates `FormData` and sends `POST /api/contracts/upload` with Bearer token.
- **Connections**: Uploads file to `backend/routes/contractRoutes.js`.

#### `frontend/src/pages/Dashboard.jsx`
- **Purpose**: Central command center for contract analysis, clause review, and RAG Q&A.
- **Key Functions**:
  - `fetchContracts()`: Calls `GET /api/contracts` to populate library cards.
  - `fetchVectorStats()`: Calls `GET /api/contracts/stats/vectors` for ChromaDB metrics.
  - `handleExtract(contractId)`: Triggers AI parsing pipeline via `POST /api/contracts/:id/extract`.
  - `handleViewClauses(contract)`: Fetches clauses via `GET /api/contracts/:id/clauses` and displays modal.
  - `handleOpenQa(contract, query)`: Opens grounded Q&A modal for document-specific or cross-contract queries.
  - `executeQaQuery(contract, query)`: Sends `POST /api/contracts/:id/ask` or `POST /api/contracts/search`.
  - `handleDelete(contractId)`: Deletes contract record, local file, and ChromaDB vector embeddings.
- **Connections**: Consumes all endpoints in `contractRoutes.js`.

#### `frontend/src/index.css` & `App.css`
- **Purpose**: Complete design system with glassmorphism, responsive cards, color-coded risk tags, and animations.

---

### 2. Backend Gateway Tier (`backend/`)

#### `backend/server.js`
- **Purpose**: Express 5 HTTP server initialization and service routing.
- **Key Functions**:
  - Configures CORS, JSON body parser (`express.json()`).
  - Calls `connectDB()` to establish MongoDB connection.
  - Mounts routes:
    - `/api/auth` &rarr; `authRoutes.js`
    - `/api/contracts` &rarr; `contractRoutes.js`
  - Health check endpoints: `GET /` and `GET /health`.
  - Starts HTTP server on port 5000.
- **Connections**: Entry point for all incoming API traffic from frontend.

#### `backend/config/db.js`
- **Purpose**: MongoDB database connection manager.
- **Key Functions**:
  - `connectDB()`: Connects to MongoDB Atlas using `mongoose.connect(process.env.MONGO_URI)`.
- **Connections**: Required by `server.js` before accepting HTTP requests.

#### `backend/middleware/authMiddleware.js`
- **Purpose**: JWT verification middleware for route protection.
- **Key Functions**:
  - `protect(req, res, next)`: Extracts Bearer token from `Authorization` header, verifies with `jwt.verify(token, JWT_SECRET)`, fetches user from `User.js` excluding password, and attaches to `req.user`.
- **Connections**: Protects all endpoints in `contractRoutes.js`.

#### `backend/models/User.js`
- **Purpose**: Mongoose schema for user accounts.
- **Fields**:
  - `name` (String, required)
  - `email` (String, required, unique, lowercase)
  - `password` (String, required, minlength 6)
  - `createdAt`, `updatedAt` (Timestamps)
- **Connections**: Used by `authRoutes.js` and referenced by `Document.js`.

#### `backend/models/Document.js`
- **Purpose**: Mongoose schema for contract metadata.
- **Fields**:
  - `user` (ObjectId, ref: 'User', required)
  - `title` (String, required)
  - `fileName` (String, required)
  - `filePath` (String, required)
  - `fileType` (String, enum: `['pdf', 'docx', 'txt']`)
  - `fileSize` (Number, required)
  - `status` (String, enum: `['uploaded', 'processing', 'completed', 'failed']`)
  - `pageCount`, `totalTokens`, `totalSections`, `vectorIndexed`, `vectorCount`, `extractedAt`
- **Connections**: Managed by `contractRoutes.js`.

#### `backend/models/Clause.js`
- **Purpose**: Mongoose schema for extracted legal clauses.
- **Fields**:
  - `document` (ObjectId, ref: 'Document', required)
  - `clauseType` (String, required, e.g. "Termination", "Indemnity & Defense")
  - `text` (String, required)
  - `riskLevel` (String, enum: `['low', 'medium', 'high']`, default: 'low')
  - `riskReason` (String)
- **Connections**: Populated during extraction in `contractRoutes.js`.

#### `backend/routes/authRoutes.js`
- **Purpose**: User account authentication endpoints.
- **Endpoints**:
  - `POST /register`: Validates uniqueness, hashes password with `bcryptjs`, saves `User`, returns JWT.
  - `POST /login`: Validates credentials, checks password hash, returns JWT.
- **Connections**: Interacts with `User.js`.

#### `backend/routes/contractRoutes.js`
- **Purpose**: Core contract lifecycle controller.
- **Endpoints**:
  - `POST /upload`: Multer stores file in `backend/uploads/`, creates `Document` record.
  - `GET /`: Lists all contracts for authenticated user.
  - `GET /:id`: Fetches single contract with ownership verification.
  - `DELETE /:id`: Unlinks file, cascades deletes in MongoDB (`Clause`), calls FastAPI `POST /api/v1/vector/delete` to purge ChromaDB vectors.
  - `POST /:id/extract`: Calls FastAPI `POST /api/v1/extract-path`, saves returned clauses into MongoDB `Clause`, updates `Document` status to `'completed'`.
  - `GET /:id/clauses`: Returns all stored clauses for a contract.
  - `GET /:id/summary`: Returns document metrics.
  - `POST /:id/ask`: Proxies grounded Q&A to FastAPI `POST /api/v1/retrieve`.
  - `POST /search`: Proxies cross-contract search to FastAPI, enriches results with contract titles from MongoDB.
  - `GET /stats/vectors`: Fetches ChromaDB telemetry from FastAPI.
- **Connections**: Interacts with MongoDB models, local file system, and FastAPI AI service.

---

### 3. AI Intelligence Tier (`ai-service/`)

#### `ai-service/main.py`
- **Purpose**: FastAPI microservice application entrypoint.
- **Key Endpoints**:
  - `GET /health`: Health metrics, CPU/GPU telemetry, active embedding model.
  - `POST /api/v1/extract`: Parses uploaded file bytes.
  - `POST /api/v1/extract-path`: Parses file from server path, generates embeddings, indexes vectors.
  - `POST /api/v1/embed`: Dense vector generation endpoint.
  - `POST /api/v1/similarity`: Cosine similarity between two text strings.
  - `POST /api/v1/vector/index`: Direct vector insertion into ChromaDB.
  - `POST /api/v1/vector/delete`: Purges vectors by `document_id` or `user_id`.
  - `GET /api/v1/vector/stats`: ChromaDB vector statistics.
  - `POST /api/v1/retrieve`: Grounded semantic retrieval, hybrid re-ranking, and answer synthesis.
- **Connections**: Called by `backend/routes/contractRoutes.js`.

#### `ai-service/extractors/__init__.py`
- **Purpose**: Extractor registry and factory.
- **Key Functions**:
  - `get_extractor(filename_or_ext)`: Returns instance of `PDFDocumentExtractor`, `DOCXDocumentExtractor`, or `TXTDocumentExtractor`.
- **Connections**: Used by `extraction_service.py`.

#### `ai-service/extractors/base.py`
- **Purpose**: Abstract base classes and Pydantic schemas.
- **Key Models**:
  - `DocumentChunk`: Schema for chunks (`chunk_id`, `text`, `page_number`, `section_heading`, `clause_type`, `risk_level`, `embedding`).
  - `ExtractionResult`: Overall parsing result (`full_text`, `chunks`, `total_pages`, `total_tokens`, `classified_clauses`).
  - `BaseDocumentExtractor`: Abstract class enforcing `extract_from_bytes()` and `extract_from_path()`.
- **Connections**: Inherited by all extractors.

#### `ai-service/extractors/utils.py`
- **Purpose**: Text normalization and legal regex detection utilities.
- **Key Functions**:
  - `clean_text(text)`: Normalizes non-breaking spaces, smart quotes, cleans empty lines.
  - `count_tokens(text)`: Accurate token counts via `tiktoken` (`cl100k_base`).
  - `is_heading(line)`: Detects legal headings (`ARTICLE`, `SECTION`, numbered sections, all-caps).
- **Connections**: Used across all extractors and clause services.

#### `ai-service/extractors/pdf_extractor.py`
- **Purpose**: PDF extraction engine.
- **Key Functions**:
  - `extract_from_bytes(content, filename)`: Uses `pypdf` to extract text page-by-page, retains page numbers, detects headings, splits text into structural chunks, and calculates token counts.
- **Connections**: Instantiated by `extractors/__init__.py`.

#### `ai-service/extractors/docx_extractor.py`
- **Purpose**: Word document parser.
- **Key Functions**:
  - `_format_table(table)`: Converts embedded tables into Markdown format.
  - `extract_from_bytes(content, filename)`: Uses `python-docx` to walk document body, preserving paragraph styles, headings, tables, and character offsets.
- **Connections**: Instantiated by `extractors/__init__.py`.

#### `ai-service/extractors/txt_extractor.py`
- **Purpose**: Plain text contract parser.
- **Key Functions**:
  - `_decode_bytes(content)`: Multi-encoding detection (UTF-8, Latin-1, CP1252).
  - `extract_from_bytes(content, filename)`: Detects numbered legal subclauses (`1.1`, `(a)`, `(i)`) and flushes structured blocks.
- **Connections**: Instantiated by `extractors/__init__.py`.

#### `ai-service/extractors/chunking.py` *(Special Analysis: Disconnected Module)*
- **Purpose**: Token-based sliding window chunker.
- **Functions**: `chunk_contract_text(text, chunk_size=500, overlap=100)`.
- **Status in Architecture**: **DISCONNECTED / STANDALONE UTILITY**.
- **Why it is disconnected**: The live ingestion pipeline relies on structural boundary extractors (`pdf_extractor.py`, `docx_extractor.py`, `txt_extractor.py`) which preserve legal sections, clause headers, and page numbers. Sliding window tokenization naively splits sentences mid-thought. `chunking.py` was retained as a standalone benchmark utility and contains an `if __name__ == "__main__":` test block.

#### `ai-service/services/clause_service.py`
- **Purpose**: Domain-specific legal taxonomy classifier and risk assessment engine.
- **Key Functions**:
  - `classify_clause(text, section_heading)`: Evaluates text against 11 legal categories (`Termination`, `Indemnity & Defense`, `Limitation of Liability`, `Governing Law`, `Confidentiality`, `Payment Terms`, etc.).
  - `assess_clause_risk(text, clause_type)`: Identifies `HIGH` risk (uncapped liability, broad indemnification, 18% penalty interest) and `MEDIUM` risk (short cure periods, sole arbitration).
  - `process_chunks_into_clauses(chunks)`: Iterates over extracted chunks and enriches them with types and risk tags.
- **Connections**: Called by `extraction_service.py`.

#### `ai-service/services/embedding_service.py`
- **Purpose**: Dense semantic vectorization engine.
- **Key Classes**:
  - `DeterministicLegalVectorizer`: Generates 384-dimensional unit-normalized vectors using sub-word n-gram hashing, domain keyword weighting (`LEGAL_KEYWORDS`), and L2 normalization.
  - `EmbeddingService`: Multi-provider router supporting:
    1. Google Gemini `text-embedding-004` (384-dim)
    2. OpenAI `text-embedding-3-small`
    3. Built-in `DeterministicLegalVectorizer` (zero external dependencies)
- **Connections**: Used by `extraction_service.py`, `retrieval_service.py`, and `vector_store.py`.

#### `ai-service/services/vector_store.py`
- **Purpose**: Persistent vector database adapter.
- **Key Classes**:
  - `BaseVectorStore`: Abstract interface for future database migration (e.g. Qdrant/FAISS).
  - `ChromaVectorStore`: Production ChromaDB implementation with HNSW cosine index.
- **Key Methods**:
  - `upsert_chunks(user_id, document_id, chunks)`: Inserts embeddings and metadata.
  - `search(user_id, query_vector, document_id, top_k)`: Executes similarity search strictly isolated by `user_id`.
  - `delete_by_document(user_id, document_id)`: Cascading purge of document vectors.
  - `stats()`: Returns collection count and storage metrics.
- **Connections**: Queried by `retrieval_service.py` and called by `main.py`.

#### `ai-service/services/retrieval_service.py`
- **Purpose**: Grounded RAG retrieval, hybrid re-ranking, and answer synthesis engine.
- **Key Classes & Methods**:
  - `LegalReranker.rerank(query, candidates, top_k)`: Applies hybrid scoring:
    - 50% Dense Vector Cosine Similarity
    - 25% Lexical & Keyword Match Ratio
    - 10% Legal Taxonomy Concept Alignment
    - 10% Section Heading Alignment
    - 5% Exact Multi-Word Phrase Match
  - `RetrievalService.retrieve(...)`: Coordinates embedding, ChromaDB search (3x over-fetch), re-ranking, threshold verification (`min_score = 0.25`), and grounded answer synthesis.
  - `_synthesize_grounded_answer(...)`: Formulates prompt with strict zero-shot grounding rules and calls Google Gemini 2.5 Flash, with deterministic extractive fallback.
- **Connections**: Called by `main.py` for `/api/v1/retrieve`.

#### `ai-service/services/health_service.py`
- **Purpose**: Telemetry and system readiness inspection.
- **Key Functions**:
  - `get_health_status()`: Gathers memory usage, CPU load, vector store status, and active embedding provider.
- **Connections**: Exposed via `GET /health` in `main.py`.

---

## Inter-Service Communication & Data Payloads

| Route | Method | Calling File | Handling File | Payload Data | Response Data |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/register` | `POST` | `Register.jsx` | `authRoutes.js` | `{ name, email, password }` | `{ token, user: { id, name, email } }` |
| `/api/auth/login` | `POST` | `Login.jsx` | `authRoutes.js` | `{ email, password }` | `{ token, user: { id, name, email } }` |
| `/api/contracts/upload` | `POST` | `UploadScreen.jsx` | `contractRoutes.js` | Multipart `FormData` (`contract`, `title`) | `{ message, document }` |
| `/api/contracts` | `GET` | `Dashboard.jsx` | `contractRoutes.js` | Headers: `Bearer <token>` | `{ contracts: [...] }` |
| `/api/contracts/:id/extract` | `POST` | `Dashboard.jsx` | `contractRoutes.js` | Headers: `Bearer <token>` | `{ message, savedClausesCount, document }` |
| `/api/v1/extract-path` | `POST` | `contractRoutes.js` | `main.py` | `{ file_path, user_id, document_id, embed, index_vector }` | `ExtractionResult` JSON (chunks, tokens, clauses) |
| `/api/contracts/:id/clauses` | `GET` | `Dashboard.jsx` | `contractRoutes.js` | Headers: `Bearer <token>` | `{ contractId, title, count, clauses: [...] }` |
| `/api/contracts/:id/ask` | `POST` | `Dashboard.jsx` | `contractRoutes.js` | `{ query, top_k: 5, min_score: 0.25 }` | `{ answer, confidence, results: [...], citations: [...] }` |
| `/api/v1/retrieve` | `POST` | `contractRoutes.js` | `main.py` | `{ query, user_id, document_id, top_k, min_score, use_reranker }` | Grounded RAG JSON response |
| `/api/contracts/search` | `POST` | `Dashboard.jsx` | `contractRoutes.js` | `{ query, top_k: 5 }` | Multi-contract comparison results with titles |
| `/api/v1/vector/delete` | `POST` | `contractRoutes.js` | `main.py` | `{ user_id, document_id }` | `{ status: "success", deleted_count: N }` |

---

## Viva & Technical Interview Cheat Sheet

### 1. Why is naive sliding-window chunking (`chunking.py`) inferior to legal boundary chunking?
> *"Naive chunking cuts text purely by token count, frequently splitting clauses across sentences or separating a covenant from its exceptions (e.g. separating 'Vendor shall be liable' from 'provided that liability shall not exceed fees paid'). Our structural extractors detect legal headings and clause numbering regex, ensuring obligations and qualifications remain unified within a single vector chunk."*

### 2. How does the hybrid re-ranking algorithm improve legal retrieval?
> *"Dense semantic search alone can miss exact legal phrasing (e.g., confusing 'gross negligence' with 'ordinary negligence'). Our `LegalReranker` computes a weighted score combining dense cosine similarity (50%), lexical token ratio (25%), legal concept alignment (10%), heading match (10%), and exact phrase overlap (5%). This delivers both semantic comprehension and lexical precision."*

### 3. How does the architecture prevent LLM hallucinations?
> *"Through a three-tiered defense:*
> 1. *Strict Tenant & Document Scoping in ChromaDB.*
> 2. *Relevance Thresholding (`min_score = 0.25`): If the top candidate passage fails this cutoff, the pipeline refuses the query (`insufficient_information: True`) without making an LLM call.*
> 3. *Strict Grounding System Prompt: Instructs the model to cite exact page and clause numbers and state if evidence is absent."*

### 4. Why use a decoupled microservices architecture (Express + FastAPI)?
> *"Separation of concerns. Express handles asynchronous I/O, user authentication, file uploads, and MongoDB transactions with minimal latency. FastAPI hosts compute-intensive Python workloads—document parsing, PyTorch vector embeddings, ChromaDB indexing, and LLM orchestration. Each service can scale independently based on load."*
