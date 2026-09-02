from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid

from fin_agent.config import Config
from fin_agent.datasources.normalize import to_ts_code

logger = logging.getLogger(__name__)

_LOCK = threading.RLock()

GROUPS = ("candidate", "track")
DEFAULT_ALERT_PCT = 5
MIN_PCT = 1
MAX_PCT = 20
MAX_ITEMS = 100


def _norm_code(ts_code) -> str:
    return to_ts_code(ts_code)


class WatchlistStore:
    def __init__(self, path=None):
        if path:
            self.path = path
        else:
            config_dir = Config.get_config_dir()
            os.makedirs(config_dir, exist_ok=True)
            self.path = os.path.join(config_dir, "watchlist.json")

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

    def list_items(self) -> list:
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            return list(items)

    def index_by_group(self) -> dict:
        """返回 {group: set(ts_code)}，只包含 GROUPS 内的有效项。"""
        index = {group: set() for group in GROUPS}
        for item in self.list_items():
            code = str(item.get("ts_code") or "").strip()
            group = item.get("group")
            if code and group in index:
                index[group].add(code)
        return index

    def get(self, item_id: str):
        target = str(item_id or "").strip()
        if not target:
            return None
        for item in self.list_items():
            if str(item.get("id") or "") == target:
                return item
        return None

    def find_by_ts_code(self, ts_code):
        try:
            code = _norm_code(ts_code)
        except ValueError:
            return None
        for item in self.list_items():
            if str(item.get("ts_code") or "") == code:
                return item
        return None

    def add(self, ts_code, group, name=None) -> dict:
        try:
            code = _norm_code(ts_code)
        except ValueError as e:
            raise ValueError(str(e) or "股票代码无效") from e
        group = str(group or "").strip()
        if group not in GROUPS:
            raise ValueError("分组无效")
        from fin_agent.portfolio import PortfolioManager

        if PortfolioManager().is_held(code):
            raise ValueError("已在持仓中，不能加入自选")
        if self.find_by_ts_code(code):
            raise ValueError("已在观察列表")

        display_name = str(name or "").strip() or code
        item_id = uuid.uuid4().hex
        from fin_agent.scheduler import TaskScheduler

        task_id = TaskScheduler().add_watchlist_move(code, DEFAULT_ALERT_PCT, item_id)
        record = {
            "id": item_id,
            "ts_code": code,
            "name": display_name,
            "group": group,
            "alert_pct": DEFAULT_ALERT_PCT,
            "alert_task_id": task_id,
            "created_at": int(time.time()),
        }
        try:
            with _LOCK:
                data = self._load()
                items = data.get("items") or []
                if any(str(it.get("ts_code") or "") == code for it in items):
                    raise ValueError("已在观察列表")
                if len(items) >= MAX_ITEMS:
                    raise ValueError("自选最多 100 只")
                items.insert(0, record)
                data["items"] = items
                self._save(data)
        except Exception:
            try:
                TaskScheduler().remove_task(task_id)
            except Exception:
                logger.warning("failed to roll back watchlist_move %s", task_id)
            raise
        return record

    def set_group(self, item_id: str, group: str) -> dict:
        group = str(group or "").strip()
        if group not in GROUPS:
            raise ValueError("分组无效")
        target = str(item_id or "").strip()
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            found = None
            for item in items:
                if str(item.get("id") or "") == target:
                    found = item
                    break
            if found is None:
                raise ValueError("未找到该自选")
            found["group"] = group
            self._save(data)
            return dict(found)

    def set_alert_pct(self, item_id: str, pct) -> dict:
        try:
            value = int(pct)
        except (TypeError, ValueError):
            raise ValueError("阈值须为 1 到 20 的整数") from None
        if value < MIN_PCT or value > MAX_PCT:
            raise ValueError("阈值须为 1 到 20 的整数")
        target = str(item_id or "").strip()
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            found = None
            for item in items:
                if str(item.get("id") or "") == target:
                    found = item
                    break
            if found is None:
                raise ValueError("未找到该自选")
            found["alert_pct"] = value
            task_id = found.get("alert_task_id")
            self._save(data)
        if task_id:
            from fin_agent.scheduler import TaskScheduler

            TaskScheduler().update_watchlist_move_pct(task_id, value)
        return dict(found)

    def remove(self, item_id: str) -> bool:
        target = str(item_id or "").strip()
        if not target:
            return False
        task_id = None
        with _LOCK:
            data = self._load()
            items = data.get("items") or []
            kept = []
            found = None
            for item in items:
                if str(item.get("id") or "") == target:
                    found = item
                else:
                    kept.append(item)
            if found is None:
                return False
            task_id = found.get("alert_task_id")
            data["items"] = kept
            self._save(data)
        if task_id:
            try:
                from fin_agent.scheduler import TaskScheduler

                TaskScheduler().remove_task(task_id)
            except Exception:
                logger.warning("failed to remove watchlist_move %s", task_id)
        return True

    def remove_by_ts_code(self, ts_code) -> bool:
        item = self.find_by_ts_code(ts_code)
        if not item:
            return False
        return self.remove(item.get("id"))
