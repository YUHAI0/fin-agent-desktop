from __future__ import annotations

import json
import re

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


_PLANNING_RE = re.compile(
    r"需带|我应|我将按|让我对|按画像|experience_level|depth按|"
    r"FIN_AGENT_REPORT|结构化输出|stock_checkup|output needs|"
    r"新手→|但不能太简|我按中等",
    re.IGNORECASE,
)
_SENTENCE_END_RE = re.compile(r"[。！？.!?…」』]$")


_TABLE_LINE_RE = re.compile(r"^\s*\|.+\|\s*$")


def _is_md_table_line(line: str) -> bool:
    t = (line or "").strip()
    return bool(_TABLE_LINE_RE.match(t) or re.match(r"^\s*\|?[-: ]+\|[-: |]+$", t))


def strip_report_preamble(text: str) -> str:
    """去掉文末自我规划句和半截尾巴，保留正文原有换行（否则 GFM 表格会碎成竖线原文）。"""
    lines = (text or "").split("\n")
    while lines:
        last = lines[-1].strip()
        if not last:
            lines.pop()
            continue
        if _is_md_table_line(last) or last.startswith("##"):
            break
        incomplete = (not _SENTENCE_END_RE.search(last)) and (
            len(last) <= 16 or bool(_PLANNING_RE.search(last))
        )
        planning = bool(_PLANNING_RE.search(last))
        if incomplete or planning:
            lines.pop()
            continue
        break
    out = "\n".join(lines).strip()
    if (
        out
        and _PLANNING_RE.search(out)
        and not out.lstrip().startswith("##")
        and len(out) <= 800
        and not ("|" in out and "---" in out)
    ):
        return ""
    return out


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


def report_tail(text: str) -> str:
    """报告 JSON 之后的正文（不含规划句和标记本身）。"""
    raw = text or ""
    idx = raw.rfind(REPORT_MARKER)
    if idx < 0:
        return raw
    obj, end = _parse_json_value(raw, idx + len(REPORT_MARKER))
    if obj is None:
        return raw
    return (raw[end:] or "").lstrip()


class ReportStreamFilter:
    """从流式 content 中扣掉合法的 FIN_AGENT_REPORT_JSON 及其 JSON 对象。

    JSON 生成期间不向界面泄出原文，但会通过 just_entered / take_ready_report
    让前端立刻显示「生成中」，避免停在「需带 / output needs the」半句上假死。
    """

    def __init__(self):
        self._buf = ""
        self._in_json = False
        self._just_entered = False
        self._ready = None
        self.report = None
        self.incomplete = False

    def take_just_entered(self) -> bool:
        flag = self._just_entered
        self._just_entered = False
        return flag

    def take_ready_report(self):
        payload = self._ready
        self._ready = None
        return payload

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
                out.append(strip_report_preamble(self._buf[:idx]))
                self._buf = self._buf[idx + len(REPORT_MARKER):]
                self._in_json = True
                self._just_entered = True
                continue
            obj, end = _parse_json_value(self._buf, 0)
            if obj is None:
                break
            json_text = self._buf[:end]
            self._buf = self._buf[end:]
            self._in_json = False
            payload = validate_report(obj)
            if payload is None:
                # 解析成功但不是合法报告：把标记和 JSON 交还可见输出
                out.append(REPORT_MARKER + json_text)
                continue
            self.report = payload
            self._ready = payload
        return "".join(out)

    def flush(self) -> str:
        if self._in_json:
            leftover = REPORT_MARKER + self._buf
            self._buf = ""
            self._in_json = False
            self.incomplete = True
            return leftover
        out = self._buf
        self._buf = ""
        return out
