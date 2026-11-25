import datetime
import os
import sys
from typing import Any, Dict

import psutil

from services.embedding_service import embedding_service
from services.llm_client import llm_client
from services.vector_store import vector_store


def get_gpu_status() -> Dict[str, Any]:
    """Detect optional CUDA or Apple Silicon acceleration without requiring PyTorch."""
    gpu_info: Dict[str, Any] = {
        "available": False,
        "mode": "CPU-only",
        "device_count": 0,
        "devices": [],
    }

    try:
        import torch

        if torch.cuda.is_available():
            gpu_info["available"] = True
            gpu_info["mode"] = "CUDA"
            gpu_info["device_count"] = torch.cuda.device_count()
            gpu_info["devices"] = [
                {
                    "id": i,
                    "name": torch.cuda.get_device_name(i),
                    "memory_total_mb": round(
                        torch.cuda.get_device_properties(i).total_memory / (1024 * 1024), 2
                    ),
                }
                for i in range(torch.cuda.device_count())
            ]
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            gpu_info["available"] = True
            gpu_info["mode"] = "Apple Silicon MPS"
    except ImportError:
        gpu_info["note"] = "Running standard CPU pipeline"
    except Exception as err:
        gpu_info["error"] = str(err)

    return gpu_info


def get_health_status() -> Dict[str, Any]:
    """Collect runtime health metrics, active AI providers, and vector index stats."""
    process = psutil.Process(os.getpid())
    process_mem = process.memory_info().rss / (1024 * 1024)

    sys_mem = psutil.virtual_memory()
    total_mem_mb = round(sys_mem.total / (1024 * 1024), 1)
    avail_mem_mb = round(sys_mem.available / (1024 * 1024), 1)
    used_mem_mb = round(sys_mem.used / (1024 * 1024), 1)

    return {
        "status": "healthy",
        "service": "Legal Contract Agent - AI Service",
        "version": "2.1.0",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "python_version": sys.version.split()[0],
        "system": {
            "memory": {
                "total_mb": total_mem_mb,
                "available_mb": avail_mem_mb,
                "used_mb": used_mem_mb,
                "percent_used": sys_mem.percent,
                "process_memory_mb": round(process_mem, 1),
            },
            "cpu": {
                "percent_used": psutil.cpu_percent(interval=None),
                "logical_cores": psutil.cpu_count(logical=True),
                "physical_cores": psutil.cpu_count(logical=False),
            },
            "gpu": get_gpu_status(),
        },
        "extractors_ready": {
            "pdf": True,
            "docx": True,
            "txt": True,
            "tokenizer": "tiktoken (cl100k_base)",
        },
        "embeddings_ready": True,
        "embedding_provider": embedding_service.get_provider_name(),
        "llm_provider": llm_client.get_active_provider(),
        "vector_store_ready": True,
        "vector_store": vector_store.stats(),
    }
