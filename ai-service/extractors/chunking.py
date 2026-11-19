from typing import List

from extractors.utils import get_token_encoder


def chunk_contract_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
    """
    Split a long contract into overlapping token windows so boundary sentences
    keep surrounding context intact.
    """
    if not text:
        return []

    tokenizer = get_token_encoder()
    tokens = tokenizer.encode(text, disallowed_special=())

    chunks: List[str] = []
    step_size = max(1, chunk_size - overlap)

    for start in range(0, len(tokens), step_size):
        window = tokens[start : start + chunk_size]
        chunks.append(tokenizer.decode(window))
        if start + chunk_size >= len(tokens):
            break

    return chunks
