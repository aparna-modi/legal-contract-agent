import json
import logging
import os
import time
from typing import Optional, Type, TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()
logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

FAST_GEMINI_MODELS = (
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
)
BALANCED_GEMINI_MODELS = (
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
)
STRONG_GEMINI_MODELS = (
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
)
MODEL_TRANSIENT_COOLDOWN_SECONDS = 15.0
MODEL_NOT_FOUND_COOLDOWN_SECONDS = 300.0


class LLMClient:
    """Wrapper around Gemini (google-genai) and OpenAI with per-model cooldowns and bounded latency."""

    def __init__(self) -> None:
        self._disabled_gemini_keys: set[str] = set()
        self._disabled_openai_keys: set[str] = set()
        self._model_cooldowns: dict[str, float] = {}
        self._clients: dict[str, object] = {}

    def _get_gemini_key(self) -> Optional[str]:
        key = (os.environ.get("GEMINI_API_KEY") or "").strip()
        if not key or key == "your_gemini_api_key_here" or key in self._disabled_gemini_keys:
            return None
        return key

    def _get_openai_key(self) -> Optional[str]:
        key = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if not key or key == "your_openai_api_key_here" or key in self._disabled_openai_keys:
            return None
        return key

    def is_llm_available(self) -> bool:
        return bool(self._get_gemini_key() or self._get_openai_key())

    def _get_genai_client(self, api_key: str):
        if api_key not in self._clients:
            from google import genai
            from google.genai import types

            self._clients[api_key] = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=35_000),
            )
        return self._clients[api_key]

    def _model_candidates(self, tier: str = "balanced") -> tuple[str, ...]:
        override = os.environ.get("GEMINI_LLM_MODEL", "").strip()
        if tier == "strong":
            ordered = STRONG_GEMINI_MODELS
        elif tier == "fast":
            ordered = FAST_GEMINI_MODELS
        else:
            ordered = BALANCED_GEMINI_MODELS

        if override:
            return (override, *(m for m in ordered if m != override))
        return ordered

    def get_active_provider(self) -> str:
        if self._get_gemini_key():
            return f"gemini ({self._model_candidates()[0]})"
        if self._get_openai_key():
            return "openai (gpt-4o-mini)"
        return "local-extractive"

    def generate_text(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        max_output_tokens: int = 1200,
        timeout: float = 20.0,
        tier: str = "balanced",
    ) -> Optional[str]:
        gemini_key = self._get_gemini_key()
        if gemini_key:
            text = self._call_gemini(
                gemini_key, prompt, system_instruction, max_output_tokens, None, timeout, tier
            )
            if text:
                return text

        openai_key = self._get_openai_key()
        if openai_key:
            return self._call_openai(
                openai_key, prompt, system_instruction, max_output_tokens, False, timeout
            )
        return None

    def generate_structured(
        self,
        prompt: str,
        schema: Type[T],
        system_instruction: Optional[str] = None,
        max_output_tokens: int = 1800,
        timeout: float = 24.0,
        tier: str = "balanced",
    ) -> Optional[T]:
        gemini_key = self._get_gemini_key()
        if gemini_key:
            raw = self._call_gemini(
                gemini_key, prompt, system_instruction, max_output_tokens, schema, timeout, tier
            )
            parsed = self._parse_schema(raw, schema) if raw else None
            if parsed is not None:
                return parsed

        openai_key = self._get_openai_key()
        if openai_key:
            schema_prompt = (
                f"{prompt}\n\nRespond ONLY with valid JSON matching this schema:\n"
                f"{json.dumps(schema.model_json_schema())}"
            )
            raw = self._call_openai(
                openai_key, schema_prompt, system_instruction, max_output_tokens, True, timeout
            )
            if raw:
                return self._parse_schema(raw, schema)
        return None

    def ocr_pdf_bytes(self, pdf_bytes: bytes, timeout: float = 35.0) -> Optional[list[str]]:
        gemini_key = self._get_gemini_key()
        if not gemini_key or not pdf_bytes:
            return None
        try:
            from google.genai import types

            client = self._get_genai_client(gemini_key)
            prompt = (
                "Transcribe all readable legal text from this scanned PDF contract accurately. "
                "Preserve section headings, numbering, and clauses. "
                "Separate each page with a line containing exactly '---PAGE_BREAK---'. "
                "Output only the transcribed contract text without commentary."
            )
            pdf_part = types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")
            for model in self._model_candidates():
                if self._model_cooldowns.get(model, 0.0) > time.monotonic():
                    continue
                try:
                    resp = client.models.generate_content(model=model, contents=[pdf_part, prompt])
                    text = getattr(resp, "text", None)
                    if text and text.strip():
                        pages = [p.strip() for p in text.split("---PAGE_BREAK---") if p.strip()]
                        return pages or [text.strip()]
                except Exception as exc:
                    msg = str(exc).lower()
                    logger.warning("Gemini OCR failed on model=%s: %s", model, type(exc).__name__)
                    if any(k in msg for k in ("api key", "401", "403")):
                        self._disabled_gemini_keys.add(gemini_key)
                        return None
                    if any(k in msg for k in ("not found", "404")):
                        self._model_cooldowns[model] = time.monotonic() + MODEL_NOT_FOUND_COOLDOWN_SECONDS
                    elif any(k in msg for k in ("503", "429", "quota", "timeout", "timed out")):
                        self._model_cooldowns[model] = time.monotonic() + MODEL_TRANSIENT_COOLDOWN_SECONDS
        except Exception as exc:
            logger.warning("Gemini OCR aborted: %s", type(exc).__name__)
            return None
        return None

    def _call_gemini(
        self,
        api_key: str,
        prompt: str,
        system_instruction: Optional[str],
        max_output_tokens: int,
        response_schema: Optional[Type[BaseModel]],
        timeout: float,
        tier: str = "balanced",
    ) -> Optional[str]:
        try:
            from google.genai import types

            client = self._get_genai_client(api_key)
        except Exception:
            return None

        deadline = time.monotonic() + timeout
        for model in self._model_candidates(tier):
            now = time.monotonic()
            if self._model_cooldowns.get(model, 0.0) > now:
                continue
            if deadline - now < 1.5:
                break

            cfg_kwargs: dict = {
                "temperature": 0.15,
                "max_output_tokens": max_output_tokens,
            }
            if system_instruction:
                cfg_kwargs["system_instruction"] = system_instruction
            if response_schema is not None:
                cfg_kwargs["response_mime_type"] = "application/json"
                cfg_kwargs["response_schema"] = response_schema

            for attempt in range(2):
                try:
                    resp = client.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(**cfg_kwargs),
                    )
                    output = getattr(resp, "text", None)
                    if output and output.strip():
                        return output.strip()
                    break
                except Exception as exc:
                    msg = str(exc).lower()
                    logger.warning("Gemini call failed model=%s attempt=%d: %s", model, attempt + 1, type(exc).__name__)
                    if any(k in msg for k in ("api key", "401", "403", "permission")):
                        self._disabled_gemini_keys.add(api_key)
                        return None
                    is_transient = any(k in msg for k in ("503", "429", "timeout", "timed out", "unavailable"))
                    if is_transient and attempt == 0 and (deadline - time.monotonic()) > 4.0:
                        time.sleep(0.8)
                        continue
                    if any(k in msg for k in ("not found", "404")):
                        self._model_cooldowns[model] = time.monotonic() + MODEL_NOT_FOUND_COOLDOWN_SECONDS
                    elif any(k in msg for k in ("503", "429", "quota", "timeout", "timed out")):
                        self._model_cooldowns[model] = time.monotonic() + MODEL_TRANSIENT_COOLDOWN_SECONDS
                    break
        return None

    def _call_openai(
        self,
        api_key: str,
        prompt: str,
        system_instruction: Optional[str],
        max_output_tokens: int,
        json_mode: bool,
        timeout: float,
    ) -> Optional[str]:
        messages = (
            [{"role": "system", "content": system_instruction}] if system_instruction else []
        ) + [{"role": "user", "content": prompt}]
        payload: dict = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_output_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
                if resp.status_code == 200:
                    return resp.json()["choices"][0]["message"]["content"].strip()
                if resp.status_code in (401, 403):
                    self._disabled_openai_keys.add(api_key)
        except Exception:
            pass
        return None

    @staticmethod
    def _parse_schema(raw: str, schema: Type[T]) -> Optional[T]:
        text = raw.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        try:
            return schema.model_validate_json(text)
        except Exception:
            start, end = text.find("{"), text.rfind("}")
            if start != -1 and end > start:
                try:
                    return schema.model_validate_json(text[start : end + 1])
                except Exception:
                    return None
        return None


llm_client = LLMClient()
