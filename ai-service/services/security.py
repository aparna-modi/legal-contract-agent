import hmac
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import Header, HTTPException, status

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))


def get_internal_api_key() -> Optional[str]:
    key = os.environ.get("INTERNAL_API_KEY", "").strip()
    if not key or key in ("your_internal_service_key_here",):
        return None
    return key


def is_production() -> bool:
    return os.environ.get("APP_ENV", os.environ.get("ENV", "development")).lower() == "production"


def require_internal_auth(
    x_internal_service_key: Optional[str] = Header(default=None, alias="X-Internal-Service-Key"),
) -> None:
    """
    Authenticate service-to-service requests between the Express API gateway and AI service.
    Enforced whenever INTERNAL_API_KEY is configured, and fail-closed in production.
    """
    expected = get_internal_api_key()
    if not expected:
        if is_production():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service internal authentication is not configured for production.",
            )
        return

    if not x_internal_service_key or not hmac.compare_digest(x_internal_service_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized internal service request.",
        )


def _allowed_roots() -> list[Path]:
    roots: list[Path] = []
    configured = os.environ.get("ALLOWED_UPLOAD_DIRS", "").strip()
    if configured:
        for entry in configured.split(os.pathsep):
            entry = entry.strip()
            if entry:
                roots.append(Path(entry).resolve())
    else:
        ai_root = Path(__file__).resolve().parent.parent
        repo_root = ai_root.parent
        roots.extend(
            [
                (repo_root / "backend" / "uploads").resolve(),
                (ai_root / "uploads").resolve(),
                Path("/app/uploads").resolve(),
                Path(tempfile.gettempdir()).resolve(),
            ]
        )
    return roots


def validate_safe_file_path(file_path: str) -> Path:
    """
    Prevent Local File Inclusion (LFI) and path traversal on /api/v1/extract-path.
    Ensures the target path is a regular contract file inside an authorized directory.
    """
    if not file_path or "\x00" in file_path:
        raise HTTPException(status_code=400, detail="Invalid file path.")

    resolved = Path(file_path).resolve()
    ext = resolved.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{ext or 'none'}'. Only .pdf, .docx, and .txt are allowed.",
        )

    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"File not found on server: '{file_path}'")

    allowed = _allowed_roots()
    if not any(_is_within(resolved, root) for root in allowed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: file path is outside authorized upload directories.",
        )

    return resolved


def _is_within(target: Path, root: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def validate_file_content(content: bytes, filename: str) -> None:
    """Validate upload byte size and file magic signatures to reject disguised payloads."""
    if not content:
        raise HTTPException(status_code=400, detail=f"File '{filename}' is empty.")

    if len(content) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {max_mb:.0f} MB.",
        )

    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{ext}'. Only .pdf, .docx, and .txt are allowed.",
        )

    if ext == ".pdf":
        # Some PDFs have leading whitespace/BOM before %PDF-
        header = content[:1024]
        if b"%PDF-" not in header:
            raise HTTPException(
                status_code=400,
                detail="Invalid PDF file signature. The uploaded file does not appear to be a valid PDF.",
            )
    elif ext == ".docx":
        if not (content.startswith(b"PK\x03\x04") or content.startswith(b"PK\x05\x06")):
            raise HTTPException(
                status_code=400,
                detail="Invalid DOCX file signature. The uploaded file does not appear to be a valid Word archive.",
            )
    elif ext == ".txt":
        if b"\x00" in content[:4096]:
            raise HTTPException(
                status_code=400,
                detail="Invalid TXT file: binary content detected.",
            )
