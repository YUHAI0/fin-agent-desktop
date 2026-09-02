from __future__ import annotations

import json
import os
import threading
import time
import uuid

from fin_agent.config import Config
from fin_agent.report_parse import DISCLAIMER, validate_report

_LOCK = threading.RLock()
_MAX_ITEMS = 500


class AnalysisFavoritesStore:
    def __init__(self, path=None):
        if path:
            self.path = path
        else:
            config_dir = Config.get_config_dir()
            os.makedirs(config_dir, exist_ok=True)
            self.path = os.path.join(config_dir, "analysis_favorites.json")

    def _load(self):
        if not os.path.exists(self.path):
            return {"items": []}
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            return {"items": []}
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            return {"items": []}
        return data

    def _save(self, data):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)

    def add(self, payload: dict, source_session_id=None) -> dict:
        report = validate_report(payload)
        if report is None:
            raise ValueError("报告内容不完整")
        record = {
            "id": uuid.uuid4().hex,
            "created_at": int(time.time()),
            **report,
            "disclaimer": report.get("disclaimer") or DISCLAIMER,
            "source_session_id": (str(source_session_id).strip() if source_session_id else None),
        }
        with _LOCK:
            data = self._load()
            data["items"].insert(0, record)
            data["items"] = data["items"][:_MAX_ITEMS]
            self._save(data)
        return record

    def list_items(self) -> list:
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            return list(items)

    def remove(self, item_id: str) -> bool:
        target = str(item_id or "").strip()
        if not target:
            return False
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            kept = [it for it in items if str(it.get("id") or "") != target]
            if len(kept) == len(items):
                return False
            data["items"] = kept
            self._save(data)
            return True
