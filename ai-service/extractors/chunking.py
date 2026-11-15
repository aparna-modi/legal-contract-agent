try:
    import tiktoken
except ModuleNotFoundError:
    import os
    import subprocess
    import sys

    _venv_py = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        ".venv",
        "Scripts" if os.name == "nt" else "bin",
        "python.exe" if os.name == "nt" else "python",
    )
    if os.path.exists(_venv_py) and os.path.abspath(sys.executable) != os.path.abspath(_venv_py):
        sys.exit(subprocess.call([_venv_py, *sys.argv]))
    raise


def chunk_contract_text(text, chunk_size=500, overlap=100):
    """
    Slices a long legal document into 500-token chunks with a 100-token overlap.
    This ensures no legal clauses are accidentally cut in half.
    """
    if not text:
        return []

    # 1. Load the industry-standard tokenizer
    tokenizer = tiktoken.get_encoding("cl100k_base")
    
    tokens = tokenizer.encode(text)
    
    chunks = []
    step_size = max(1, chunk_size - overlap)
    
    for i in range(0, len(tokens), step_size):
        # Grab the current slice of 500 tokens
        chunk_tokens = tokens[i : i + chunk_size]
        
        # Convert the tokens back into readable text
        chunk_text = tokenizer.decode(chunk_tokens)
        chunks.append(chunk_text)
        
        # Stop if we have reached the end of the document
        if i + chunk_size >= len(tokens):
            break
            
    return chunks

# --- Quick Test to prove it works for your Viva ---
if __name__ == "__main__":
    sample_legal_text = "The vendor shall indemnify the purchaser. " * 200
    result = chunk_contract_text(sample_legal_text)
    print(f"Successfully created {len(result)} chunks!")
    print(f"First chunk length: {len(tiktoken.get_encoding('cl100k_base').encode(result[0]))} tokens")