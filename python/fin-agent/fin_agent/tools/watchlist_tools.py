from fin_agent.watchlist import WatchlistStore

_GROUP_LABEL = {
    "candidate": "候选买入",
    "track": "长期跟踪",
}

_GROUP_ALIAS = {
    "candidate": "candidate",
    "track": "track",
    "候选买入": "candidate",
    "长期跟踪": "track",
    "候选": "candidate",
    "跟踪": "track",
}


def _norm_group(group):
    raw = str(group or "candidate").strip()
    return _GROUP_ALIAS.get(raw.lower()) or _GROUP_ALIAS.get(raw) or "candidate"


def add_watchlist(ts_code, group="candidate", name=None):
    """把股票加入自选（观察列表），关注但未买入。"""
    try:
        item = WatchlistStore().add(ts_code, _norm_group(group), name)
    except ValueError as e:
        return f"Error: {e}"
    except Exception:
        return "Error: 加入自选失败"
    label = _GROUP_LABEL.get(item.get("group"), item.get("group"))
    return (
        f"已将 {item.get('name')}（{item.get('ts_code')}）加入自选「{label}」，"
        f"并设置相对昨收 ±{item.get('alert_pct')}% 异动提醒。"
    )


def list_watchlist():
    """列出当前自选股。"""
    items = WatchlistStore().list_items()
    if not items:
        return "自选列表为空。"
    lines = ["自选列表："]
    for item in items:
        label = _GROUP_LABEL.get(item.get("group"), item.get("group"))
        lines.append(
            f"- {item.get('name')}（{item.get('ts_code')}）· {label} · "
            f"异动阈值 ±{item.get('alert_pct')}%"
        )
    return "\n".join(lines)


def remove_watchlist(ts_code):
    """按股票代码移出自选。"""
    store = WatchlistStore()
    item = store.find_by_ts_code(ts_code)
    if not item:
        return "Error: 自选中没有该股票"
    ok = store.remove(item.get("id"))
    if not ok:
        return "Error: 移出自选失败"
    return f"已将 {item.get('name')}（{item.get('ts_code')}）移出自选。"


WATCHLIST_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "add_watchlist",
            "description": (
                "将股票加入自选/观察列表（关注但未买入，与持仓分开）。"
                "用户说「加入自选」「加入观察」「自选股」且已有股票代码时必须调用。"
                "已在持仓中的股票不能加入。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ts_code": {
                        "type": "string",
                        "description": "股票代码，如 600519.SH 或 000001.SZ。",
                    },
                    "group": {
                        "type": "string",
                        "description": "candidate（候选买入，默认）或 track（长期跟踪）。",
                    },
                    "name": {
                        "type": "string",
                        "description": "股票中文名，可选。",
                    },
                },
                "required": ["ts_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_watchlist",
            "description": "查看当前自选/观察列表。用户问「我的自选」「观察列表」时调用。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_watchlist",
            "description": "按股票代码从自选/观察列表移除。",
            "parameters": {
                "type": "object",
                "properties": {
                    "ts_code": {
                        "type": "string",
                        "description": "股票代码。",
                    },
                },
                "required": ["ts_code"],
            },
        },
    },
]
