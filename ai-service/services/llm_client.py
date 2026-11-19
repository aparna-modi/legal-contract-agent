import json
import os
from typing import Optional, Type, TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

T = TypeVar("T", bound=BaseModel)

DEFAULT_GEMINI_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-4-hydrogen",
)


class LLMClient:
    """Thin wrapper around the Gemini Interactions API with optional OpenAI fallback."""

    def __init__(self) -> None:
        self._disabled_gemini_keys: set[str] = set()
        self._disabled_openai_keys: set[str] = set()
        self._clients: dict[str, object] = {}

    def _get_gemini_key(self) -> Optional[str]:
        key = os.environ.get("GEMINI_API_KEY")
        if not key or key.strip() in ("", "your_gemini_api_key_here"):
            return None
        if key in self._disabled_gemini_keys:
            return None
        return key

    def _get_openai_key(self) -> Optional[str]:
        key = os.environ.get("OPENAI_API_KEY")
        if not key or key.strip() in ("", "your_openai_api_key_here"):
            return None
        if key in self._disabled_openai_keys:
            return None
        return key

    def _get_genai_client(self, api_key: str):
        if api_key not in self._clients:
            from google import genai

            self._clients[api_key] = genai.Client(api_key=api_key)
        return self._clients[api_key]

    def _model_candidates(self) -> tuple[str, ...]:
        override = os.environ.get("GEMINI_LLM_MODEL", "").strip()
        if override:
            rest = tuple(m for m in DEFAULT_GEMINI_MODELS if m != override)
            return (override, *rest)
        return DEFAULT_GEMINI_MODELS

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
        max_output_tokens: int = 1024,
        timeout: float = 15.0,
    ) -> Optional[str]:
        """Generate plain text using Gemini Interactions API (with OpenAI fallback)."""
        gemini_key = self._get_gemini_key()
        if gemini_key:
            text = self._call_gemini(
                api_key=gemini_key,
                prompt=prompt,
                system_instruction=system_instruction,
                max_output_tokens=max_output_tokens,
                response_format=None,
                timeout=timeout,
            )
            if text:
                return text

        openai_key = self._get_openai_key()
        if openai_key:
            return self._call_openai(
                api_key=openai_key,
                prompt=prompt,
                system_instruction=system_instruction,
                max_output_tokens=max_output_tokens,
                json_mode=False,
                timeout=timeout,
            )

        return None

    def generate_structured(
        self,
        prompt: str,
        schema: Type[T],
        system_instruction: Optional[str] = None,
        max_output_tokens: int = 1200,
        timeout: float = 18.0,
    ) -> Optional[T]:
        """Generate a validated Pydantic object using Gemini structured JSON output."""
        json_schema = schema.model_json_schema()
        response_format = {
            "type": "text",
            "mime_type": "application/json",
            "schema": json_schema,
        }

        gemini_key = self._get_gemini_key()
        if gemini_key:
            raw = self._call_gemini(
                api_key=gemini_key,
                prompt=prompt,
                system_instruction=system_instruction,
                max_output_tokens=max_output_tokens,
                response_format=response_format,
                timeout=timeout,
            )
            if raw:
                parsed = self._parse_schema(raw, schema)
                if parsed is not None:
                    return parsed

        openai_key = self._get_openai_key()
        if openai_key:
            schema_prompt = (
                f"{prompt}\n\nRespond ONLY with valid JSON matching this schema:\n"
                f"{json.dumps(json_schema)}"
            )
            raw = self._call_openai(
                api_key=openai_key,
                prompt=schema_prompt,
                system_instruction=system_instruction,
                max_output_tokens=max_output_tokens,
                json_mode=True,
                timeout=timeout,
            )
            if raw:
                parsed = self._parse_schema(raw, schema)
                if parsed is not None:
                    return parsed

        return None

    def _call_gemini(
        self,
        api_key: str,
        prompt: str,
        system_instruction: Optional[str],
        max_output_tokens: int,
        response_format: Optional[dict],
        timeout: float,
    ) -> Optional[str]:
        try:
            client = self._get_genai_client(api_key)
        except Exception:
            return None

        for model in self._model_candidates():
            gen_config: dict = {"max_output_tokens": max_output_tokens}
            if model.startswith("gemini-3.5"):
                gen_config["thinking_level"] = "minimal"
            elif model.startswith("gemini-4"):
                gen_config["thinking_level"] = "low"

            kwargs: dict = {
                "model": model,
                "input": prompt,
                "store": False,
                "generation_config": gen_config,
                "timeout": timeout,
            }
            if system_instruction:
                kwargs["system_instruction"] = system_instruction
            if response_format:
                kwargs["response_format"] = response_format

            try:
                interaction = client.interactions.create(**kwargs)
                output = getattr(interaction, "output_text", None)
                if output and output.strip():
                    return output.strip()
            except Exception as exc:
                err_msg = str(exc).lower()
                # Auth errors invalidate the key for the rest of this process.
                if "api key" in err_msg or "401" in err_msg or "403" in err_msg or "permission" in err_msg:
                    self._disabled_gemini_keys.add(api_key)
                    return None
                # Try the next model on model-not-found, timeout, or transient failure.
                continue

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
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload: dict = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "temperature": 0.0,
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
            try:
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end > start:
                    return schema.model_validate_json(text[start : end + 1])
            except Exception:
                return None
        return None


llm_client = LLMClient()
