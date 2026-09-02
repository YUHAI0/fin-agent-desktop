from __future__ import annotations

import json

REPORT_MARKER = "FIN_AGENT_REPORT_JSON"
DISCLAIMER = "以上内容仅供参考，不构成投资建议。"
KINDS = ("stock_checkup", "portfolio_diagnose", "trade_memo")
DEPTHS = ("brief", "standard", "full")
SECTION_KEYS = ("conclusion", "evidence", "risk", "next")


def _skip_ws(text: str, i: int) -> int:
    n = len(text)
    while i < n and text[i] in " \t\r\n":
        i += 1
    return i


def _parse_json_value(text: str, start: int):
    """从 start 解析一个 JSON 值，返回 (obj, end_index)。失败返回 (None, start)。"""
    i = _skip_ws(text, start)
    if i >= len(text):
        return None, start
    try:
        obj, end = json.JSONDecoder().raw_decode(text, i)
    except json.JSONDecodeError:
        return None, start
    return obj, end


def validate_report(obj) -> dict | None:
    if not isinstance(obj, dict):
        return None
    kind = obj.get("kind")
    title = str(obj.get("title") or "").strip()
    if kind not in KINDS or not title:
        return None
    sections_in = obj.get("sections")
    if not isinstance(sections_in, dict):
        return None
    sections = {}
    for key in SECTION_KEYS:
        val = str(sections_in.get(key) or "").strip()
        if not val:
            return None
        sections[key] = val
    depth = obj.get("depth")
    if depth not in DEPTHS:
        depth = "standard"
    symbols = obj.get("symbols") or []
    if not isinstance(symbols, list):
        symbols = []
    symbols = [str(s).strip() for s in symbols if str(s).strip()]
    pid = obj.get("portfolio_id")
    if pid is not None:
        pid = str(pid).strip() or None
    disclaimer = str(obj.get("disclaimer") or "").strip() or DISCLAIMER
    return {
        "kind": kind,
        "title": title,
        "depth": depth,
        "symbols": symbols,
        "portfolio_id": pid,
        "sections": sections,
        "disclaimer": disclaimer,
    }


def extract_report(text: str) -> tuple[str, dict | None]:
    raw = text or ""
    idx = raw.rfind(REPORT_MARKER)
    if idx < 0:
        return raw, None
    obj, end = _parse_json_value(raw, idx + len(REPORT_MARKER))
    payload = validate_report(obj)
    if payload is None:
        return raw, None
    before = raw[:idx].rstrip()
    after = raw[end:].lstrip()
    cleaned = before if not after else f"{before}\n{after}"
    return cleaned.rstrip(), payload


class ReportStreamFilter:
    """从流式 content 中扣掉 FIN_AGENT_REPORT_JSON 及其 JSON 对象，其余（含 CHOICES）原样放出。"""

    def __init__(self):
        self._buf = ""
        self._in_json = False

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        out = []
        while self._buf:
            if not self._in_json:
                idx = self._buf.find(REPORT_MARKER)
                if idx == -1:
                    hold = 0
                    max_tail = min(len(REPORT_MARKER) - 1, len(self._buf))
                    for length in range(max_tail, 0, -1):
                        if REPORT_MARKER.startswith(self._buf[-length:]):
                            hold = length
                            break
                    if hold == 0:
                        out.append(self._buf)
                        self._buf = ""
                    else:
                        out.append(self._buf[:-hold])
                        self._buf = self._buf[-hold:]
                    break
                out.append(self._buf[:idx])
                self._buf = self._buf[idx + len(REPORT_MARKER):]
                self._in_json = True
                continue
            obj, end = _parse_json_value(self._buf, 0)
            if obj is None:
                break
            self._buf = self._buf[end:]
            self._in_json = False
        return "".join(out)

    def flush(self) -> str:
        if self._in_json:
            self._buf = ""
            self._in_json = False
            return ""
        out = self._buf
        self._buf = ""
        return out
