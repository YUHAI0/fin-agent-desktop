import requests


def normalize_local_base_url(base_url: str, backend: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    if backend == "ollama":
        return url.removesuffix("/v1") if url.endswith("/v1") else url
    if not url.endswith("/v1"):
        url = f"{url}/v1" if url else url
    return url


def list_local_models(backend: str, base_url: str, api_key: str | None = None) -> dict:
    backend = (backend or "ollama").strip().lower()
    base = normalize_local_base_url(base_url, backend)
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        if backend == "ollama":
            root = base.removesuffix("/v1") if base.endswith("/v1") else base
            resp = requests.get(f"{root}/api/tags", timeout=5)
            resp.raise_for_status()
            models = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
        else:
            resp = requests.get(f"{base}/models", headers=headers, timeout=5)
            resp.raise_for_status()
            models = [m.get("id") for m in resp.json().get("data", []) if m.get("id")]
        return {"ok": True, "models": models}
    except Exception as exc:
        hint = "请确认 Ollama 已启动（ollama serve）" if backend == "ollama" else "请确认 LM Studio 本地服务已开启"
        return {"ok": False, "error": f"无法连接本地模型服务：{exc}。{hint}"}
