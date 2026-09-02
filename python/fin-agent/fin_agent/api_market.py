"""桌面端股票详情页用的市场读接口辅助：结构化 JSON，不走 Agent 工具字符串。"""
from __future__ import annotations

from datetime import datetime, timedelta
from math import isnan
import re

from fin_agent.config import Config
from fin_agent.datasources import CapabilityNotSupported, get_provider
from fin_agent.datasources.normalize import normalize_date, to_plain_code, to_ts_code

SEARCH_LIMIT = 20
FINANCIALS_LIMIT = 8
MONEYFLOW_DAYS = 14
KLINE_LOOKBACK_DAYS = 2000  # 覆盖约 5 年交易日缓冲

PERIOD_DAYS = {
    "1M": 31,
    "3M": 93,
    "6M": 186,
    "1Y": 370,
    "3Y": 365 * 3 + 30,
    "5Y": 365 * 5 + 30,
}


def ok(data):
    return {"ok": True, "data": data}


def fail(error, code="error"):
    return {"ok": False, "error": str(error), "code": code}


def _jsonable(value):
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if isnan(value):
            return None
        return value
    if hasattr(value, "item"):
        try:
            return _jsonable(value.item())
        except Exception:
            pass
    if isinstance(value, datetime):
        return value.strftime("%Y%m%d")
    text = str(value)
    if text.lower() in ("nan", "nat", "none", ""):
        return None
    return text


def df_records(df, limit=None):
    if df is None or len(df) == 0:
        return []
    out = df.copy()
    if limit is not None:
        out = out.head(limit)
    records = []
    for row in out.to_dict(orient="records"):
        records.append({k: _jsonable(v) for k, v in row.items()})
    return records


def _require_ts_code(raw):
    if not raw or not str(raw).strip():
        raise ValueError("缺少 ts_code")
    return to_ts_code(str(raw).strip())


def _looks_like_code(q: str) -> bool:
    digits = "".join(ch for ch in q if ch.isdigit())
    return len(digits) >= 4


_TX_SUGGEST_URL = "https://smartbox.gtimg.cn/s3/"
_TX_SUGGEST_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://gu.qq.com/",
}
_TX_HINT_RE = re.compile(r'v_hint="(.*)"', re.S)
_TX_STOCK_KINDS = {"GP-A", "GP-B"}


def _decode_tencent_hint(payload: str) -> str:
    if "\\u" not in payload:
        return payload
    try:
        return payload.encode("utf-8").decode("unicode_escape")
    except Exception:
        return payload


def _search_tencent_suggest(query: str, limit: int):
    """腾讯股票联想（网页搜索同款），按关键字即时返回，不拉全市场列表。"""
    import requests

    resp = requests.get(
        _TX_SUGGEST_URL,
        params={"v": "2", "q": query, "t": "all"},
        headers=_TX_SUGGEST_HEADERS,
        timeout=3,
    )
    resp.raise_for_status()
    matched = _TX_HINT_RE.search(resp.text or "")
    raw = matched.group(1) if matched else ""
    if not raw or raw == "N":
        return []
    raw = _decode_tencent_hint(raw)
    out = []
    seen = set()
    for item in raw.split("^"):
        parts = item.split("~")
        if len(parts) < 3:
            continue
        _market, code, name = parts[0], parts[1], parts[2]
        kind = parts[4] if len(parts) > 4 else ""
        if kind and kind not in _TX_STOCK_KINDS:
            continue
        try:
            ts_code = to_ts_code(code)
        except ValueError:
            continue
        if ts_code in seen:
            continue
        seen.add(ts_code)
        out.append({
            "ts_code": ts_code,
            "symbol": to_plain_code(ts_code),
            "name": (name or "").strip() or None,
            "industry": None,
            "market": None,
        })
        if len(out) >= limit:
            break
    return out


def _search_by_exact_code(query: str, limit: int):
    provider = get_provider()
    try:
        code = to_ts_code(query)
    except ValueError:
        return []
    df = provider.get_stock_basic(ts_code=code)
    rows = df_records(df, limit=limit)
    return [
        {
            "ts_code": r.get("ts_code"),
            "symbol": r.get("symbol") or (to_plain_code(r["ts_code"]) if r.get("ts_code") else None),
            "name": r.get("name"),
            "industry": r.get("industry"),
            "market": r.get("market"),
        }
        for r in rows
        if r.get("ts_code")
    ]


def search_stocks(q: str, limit: int = SEARCH_LIMIT):
    query = (q or "").strip()
    if not query:
        return ok([])
    try:
        try:
            items = _search_tencent_suggest(query, limit)
        except Exception:
            items = []
        if items:
            return ok(items)
        if _looks_like_code(query):
            return ok(_search_by_exact_code(query, limit))
        return ok([])
    except CapabilityNotSupported as e:
        return fail(str(e), "unsupported")
    except Exception as e:
        return fail(e, "error")


def get_quote(ts_code: str):
    try:
        code = _require_ts_code(ts_code)
    except ValueError as e:
        return fail(e, "error")
    provider = get_provider()
    try:
        basic = provider.get_stock_basic(ts_code=code)
        basic_row = df_records(basic, limit=1)
        name = basic_row[0].get("name") if basic_row else None
        industry = basic_row[0].get("industry") if basic_row else None

        rt = provider.get_realtime_price(code)
        rt_rows = df_records(rt, limit=1)
        if not rt_rows:
            return fail(f"未找到 {code} 的实时行情", "not_found")
        quote = dict(rt_rows[0])
        if not quote.get("name") and name:
            quote["name"] = name
        quote["industry"] = industry

        # 实时列无开高低，用最近日线补齐
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")
        daily = provider.get_daily_price(code, start_date=start, end_date=end)
        if daily is not None and len(daily):
            daily = daily.sort_values("trade_date", ascending=False)
            latest = df_records(daily, limit=1)[0]
            for key in ("open", "high", "low", "close"):
                if quote.get(key) is None and latest.get(key) is not None:
                    quote[key] = latest.get(key)
            quote["trade_date"] = latest.get("trade_date")
        return ok(quote)
    except CapabilityNotSupported as e:
        return fail(str(e), "unsupported")
    except Exception as e:
        return fail(e, "error")


def _pct_from(closes: list, days: int):
    if not closes:
        return None
    if len(closes) <= days:
        base = closes[0]
    else:
        base = closes[-(days + 1)]
    last = closes[-1]
    if base is None or last is None or base == 0:
        return None
    return round((last - base) / base * 100, 4)


def _performance_from_daily(df):
    if df is None or len(df) == 0:
        return {}
    ordered = df.sort_values("trade_date", ascending=True)
    closes = []
    dates = []
    for _, row in ordered.iterrows():
        c = row.get("close")
        try:
            c = float(c)
            if c != c:  # NaN
                continue
        except (TypeError, ValueError):
            continue
        closes.append(c)
        dates.append(str(normalize_date(row.get("trade_date")) or ""))

    if not closes:
        return {}

    ytd = None
    year_prefix = datetime.now().strftime("%Y")
    for i, d in enumerate(dates):
        if d.startswith(year_prefix):
            base = closes[i - 1] if i > 0 else closes[i]
            last = closes[-1]
            if base:
                ytd = round((last - base) / base * 100, 4)
            break

    return {
        "w1": _pct_from(closes, 5),
        "m1": _pct_from(closes, 21),
        "m3": _pct_from(closes, 63),
        "ytd": ytd,
    }


def get_kline(ts_code: str, period: str = "6M"):
    try:
        code = _require_ts_code(ts_code)
    except ValueError as e:
        return fail(e, "error")
    period = (period or "6M").upper()
    if period not in PERIOD_DAYS:
        period = "6M"
    provider = get_provider()
    try:
        end = datetime.now()
        start_lookback = end - timedelta(days=KLINE_LOOKBACK_DAYS)
        daily = provider.get_daily_price(
            code,
            start_date=start_lookback.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adj="qfq",
        )
        if daily is None or len(daily) == 0:
            return fail(f"未找到 {code} 的日线数据", "not_found")
        daily = daily.sort_values("trade_date", ascending=True)
        performance = _performance_from_daily(daily)

        period_start = (end - timedelta(days=PERIOD_DAYS[period])).strftime("%Y%m%d")
        sliced = daily[daily["trade_date"].astype(str).str.replace(r"\D", "", regex=True) >= period_start]
        if len(sliced) == 0:
            sliced = daily
        candles = []
        for row in df_records(sliced):
            td = normalize_date(row.get("trade_date"))
            if not td or len(td) < 8:
                continue
            o, h, l, c = row.get("open"), row.get("high"), row.get("low"), row.get("close")
            if None in (o, h, l, c):
                continue
            candles.append({
                "time": f"{td[0:4]}-{td[4:6]}-{td[6:8]}",
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": row.get("vol"),
            })
        return ok({
            "ts_code": code,
            "period": period,
            "candles": candles,
            "performance": performance,
        })
    except CapabilityNotSupported as e:
        return fail(str(e), "unsupported")
    except Exception as e:
        return fail(e, "error")


def get_valuation(ts_code: str):
    try:
        code = _require_ts_code(ts_code)
    except ValueError as e:
        return fail(e, "error")
    provider = get_provider()
    try:
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        df = provider.get_daily_basic(code, start_date=start, end_date=end)
        if df is None or len(df) == 0:
            return fail(f"未找到 {code} 的估值数据", "not_found")
        df = df.sort_values("trade_date", ascending=False)
        return ok(df_records(df, limit=1)[0])
    except CapabilityNotSupported as e:
        return fail(str(e), "unsupported")
    except Exception as e:
        return fail(e, "error")


def get_financials(ts_code: str, limit: int = FINANCIALS_LIMIT):
    try:
        code = _require_ts_code(ts_code)
    except ValueError as e:
        return fail(e, "error")
    provider = get_provider()
    try:
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=365 * 4)).strftime("%Y%m%d")
        df = provider.get_income_statement(code, start_date=start, end_date=end)
        if df is None or len(df) == 0:
            return fail(f"未找到 {code} 的财务数据", "not_found")
        if "end_date" in df.columns:
            df = df.sort_values("end_date", ascending=False)
        # 同一报告期可能有多次公告，按 end_date 去重保留最新
        if "end_date" in df.columns:
            df = df.drop_duplicates(subset=["end_date"], keep="first")
        return ok(df_records(df, limit=limit))
    except CapabilityNotSupported as e:
        return fail(str(e), "unsupported")
    except Exception as e:
        return fail(e, "error")


def get_moneyflow(ts_code: str):
    try:
        code = _require_ts_code(ts_code)
    except ValueError as e:
        return fail(e, "error")
    if not Config.TUSHARE_TOKEN:
        return fail("该功能需要 Tushare Token，请在设置页配置后重试", "tushare_required")
    try:
        import tushare as ts

        ts.set_token(Config.TUSHARE_TOKEN)
        pro = ts.pro_api()
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=MONEYFLOW_DAYS)).strftime("%Y%m%d")
        df = pro.moneyflow(ts_code=code, start_date=start, end_date=end)
        if df is None or len(df) == 0:
            return fail(f"未找到 {code} 的资金流数据", "not_found")
        df = df.sort_values("trade_date", ascending=False)
        return ok(df_records(df, limit=10))
    except Exception as e:
        return fail(e, "error")
