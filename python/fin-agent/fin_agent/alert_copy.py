"""股价提醒语义化文案。"""
from dataclasses import dataclass


@dataclass
class AlertCopy:
    title: str
    body: str
    condition_label: str
    message: str


def _fmt_price(value: float) -> str:
    return f"{float(value):.2f}"


def _stock_label(stock_name: str, ts_code: str) -> str:
    name = (stock_name or ts_code or "").strip()
    code = (ts_code or "").strip()
    if name and code and name != code:
        return f"{name}({code})"
    return name or code


def format_condition_label(task: dict) -> str:
    """基于 task 元数据生成条件摘要（列表/Agent，无现价）。"""
    mode = task.get("alert_mode") or "absolute"
    threshold = task.get("threshold")
    operator = task.get("operator") or ">="
    pct = task.get("pct")
    direction = task.get("direction")
    if mode == "pct" and pct is not None and threshold is not None:
        verb = "上涨" if direction == "up" else "下跌"
        return f"{verb} {pct:g}% 至 {_fmt_price(threshold)} 元"
    if threshold is None:
        return "价格提醒"
    t = _fmt_price(threshold)
    if operator == ">=":
        return f"突破 {t} 元"
    if operator == ">":
        return f"超过 {t} 元"
    if operator == "<=":
        return f"回落至 {t} 元及以下"
    if operator == "<":
        return f"跌破 {t} 元"
    return f"价格 {operator} {t} 元"


def format_alert(task: dict, *, stock_name: str, current_price: float) -> AlertCopy:
    ts_code = task.get("ts_code") or ""
    label = _stock_label(stock_name, ts_code)
    price_s = _fmt_price(current_price)
    condition_label = format_condition_label(task)
    mode = task.get("alert_mode") or "absolute"
    threshold = task.get("threshold")

    if mode == "pct" and task.get("base_price") is not None and task.get("pct") is not None:
        base_s = _fmt_price(task["base_price"])
        pct = task["pct"]
        if task.get("direction") == "up":
            message = (
                f"{label} 较设置时（{base_s} 元）上涨 {pct:g}%，"
                f"当前 {price_s} 元，已达目标 {_fmt_price(threshold)} 元"
            )
        else:
            message = (
                f"{label} 较设置时（{base_s} 元）下跌 {pct:g}%，"
                f"当前 {price_s} 元，已达目标 {_fmt_price(threshold)} 元"
            )
    else:
        op = task.get("operator") or ">="
        t = _fmt_price(threshold) if threshold is not None else "—"
        if op == ">=":
            detail = f"价格已突破 {t} 元，当前 {price_s} 元"
        elif op == ">":
            detail = f"价格已超过 {t} 元，当前 {price_s} 元"
        elif op == "<=":
            detail = f"价格已回落到 {t} 元及以下，当前 {price_s} 元"
        else:
            detail = f"价格已跌破 {t} 元，当前 {price_s} 元"
        message = f"{label} {detail}"

    title = f"股价提醒：{label}"
    body = message
    return AlertCopy(title=title, body=body, condition_label=condition_label, message=message)


def format_watchlist_move(task: dict, *, stock_name: str, current_price: float, pct_chg: float) -> AlertCopy:
    ts_code = task.get("ts_code") or ""
    label = _stock_label(stock_name, ts_code)
    pct = task.get("pct")
    try:
        pct_n = float(pct)
    except (TypeError, ValueError):
        pct_n = 0.0
    try:
        chg = float(pct_chg)
    except (TypeError, ValueError):
        chg = 0.0
    verb = "上涨" if chg >= 0 else "下跌"
    message = (
        f"{label} 今日{verb} {abs(chg):.1f}%，超过观察阈值 {pct_n:g}%"
    )
    condition_label = f"涨跌幅 ±{pct_n:g}%"
    title = f"自选异动：{label}"
    return AlertCopy(
        title=title,
        body=message,
        condition_label=condition_label,
        message=message,
    )
