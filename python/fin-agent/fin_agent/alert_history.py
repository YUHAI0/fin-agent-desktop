"""价格提醒触发历史的本地 JSON 存储。"""
import json
import os
import threading
import time
import uuid

from fin_agent.config import Config


_LOCK = threading.RLock()
_MAX_ITEMS = 500
_FIELDS = (
    "id",
    "task_id",
    "ts_code",
    "stock_name",
    "operator",
    "threshold",
    "price",
    "triggered_at",
)


class AlertHistoryStore:
    def __init__(self, path=None):
        if path:
            self.path = path
        else:
            config_dir = Config.get_config_dir()
            os.makedirs(config_dir, exist_ok=True)
            self.path = os.path.join(config_dir, "alert_history.json")

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

    def append(self, item: dict) -> None:
        record = {key: item.get(key) for key in _FIELDS}
        if not record.get("id"):
            record["id"] = uuid.uuid4().hex
        if record.get("triggered_at") is None:
            record["triggered_at"] = time.time()
        with _LOCK:
            data = self._load()
            data["items"].insert(0, record)
            data["items"] = data["items"][:_MAX_ITEMS]
            self._save(data)

    def list_items(self, limit=100) -> list:
        try:
            cap = max(int(limit), 0)
        except (TypeError, ValueError):
            cap = 100
        with _LOCK:
            items = self._load().get("items") or []
            return items[:cap]
