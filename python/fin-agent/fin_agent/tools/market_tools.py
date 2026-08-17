"""统一的行情工具层：调用 provider、序列化结果、把不支持的能力转为中文提示。"""
import functools

from fin_agent.config import Config
from fin_agent.datasources import CapabilityNotSupported, get_provider

TUSHARE_REQUIRED_HINT = (
    "该功能需要 Tushare Token 才能使用。请打开设置页填写 Tushare Token 后重试，"
    "或改用当前数据源已支持的功能。"
)


def df_to_json(df):
    if df is None or len(df) == 0:
        return "[]"
    return df.to_json(orient="records", force_ascii=False, date_format="iso")


def _friendly_error(exc):
    text = str(exc)
    lowered = text.casefold()
    if "remote disconnected" in lowered or "connection aborted" in lowered or "连接" in text:
        return "行情源暂时连不上，请稍后重试"
    return f"Error: {text}"


def _guard(func):
    """把 provider 抛出的异常转为可直接回给模型的中文文本。"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except CapabilityNotSupported as e:
            return f"{e}。可在设置页切换数据源后重试。"
        except Exception as e:
            return _friendly_error(e)
    return wrapper


def requires_tushare(func):
    """标记仅 Tushare 可用的工具：无 Token 时直接返回引导语，不调用底层接口。"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        if not Config.TUSHARE_TOKEN:
            return TUSHARE_REQUIRED_HINT
        return func(*args, **kwargs)
    return wrapper


@_guard
def get_stock_basic(ts_code=None, name=None):
    return df_to_json(get_provider().get_stock_basic(ts_code=ts_code, name=name))


@_guard
def get_daily_price(ts_code, start_date=None, end_date=None, adj=None):
    return df_to_json(get_provider().get_daily_price(ts_code, start_date, end_date, adj))


@_guard
def get_realtime_price(ts_code):
    return df_to_json(get_provider().get_realtime_price(ts_code))


_NEW_SHARE_LIMIT_DEFAULT = 20
_NEW_SHARE_LIMIT_MAX = 50

_NEW_SHARE_COLUMNS = [
    "ts_code", "name", "price", "change", "pct_chg",
    "open", "high", "low", "pre_close", "vol", "amount",
    "turnover", "pe", "pb", "list_date", "total_mv", "circ_mv",
]

_EM_NEW_SHARE_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://quote.eastmoney.com/center/gridlist.html",
    "Connection": "close",
}

_EM_NEW_SHARE_URLS = (
    "https://push2.eastmoney.com/api/qt/clist/get",
    "https://82.push2.eastmoney.com/api/qt/clist/get",
    "https://40.push2.eastmoney.com/api/qt/clist/get",
    "https://28.push2.eastmoney.com/api/qt/clist/get",
)

_EM_NEW_SHARE_PARAMS = {
    "pn": "1",
    "pz": "200",
    "po": "1",
    "np": "1",
    "ut": "bd1d9ddb04089700cf9c27f6f7426281",
    "fltt": "2",
    "invt": "2",
    "fid": "f3",
    "fs": "m:0 f:8,m:1 f:8",
    "fields": "f2,f3,f4,f5,f6,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21,f23,f26",
}


def _em_new_share_frame():
    """直连东财 clist 单页拉取，避免 akshare 分页撞上 RemoteDisconnected。"""
    import time
    import pandas as pd
    import requests

    last_err = None
    for url in _EM_NEW_SHARE_URLS:
        for attempt in range(3):
            try:
                resp = requests.get(
                    url,
                    params=_EM_NEW_SHARE_PARAMS,
                    headers=_EM_NEW_SHARE_HEADERS,
                    timeout=12,
                )
                resp.raise_for_status()
                diff = ((resp.json() or {}).get("data") or {}).get("diff") or []
                if not diff:
                    last_err = ValueError("empty eastmoney payload")
                    break
                rows = []
                for item in diff:
                    rows.append({
                        "代码": item.get("f12"),
                        "名称": item.get("f14"),
                        "最新价": item.get("f2"),
                        "涨跌幅": item.get("f3"),
                        "涨跌额": item.get("f4"),
                        "成交量": item.get("f5"),
                        "成交额": item.get("f6"),
                        "换手率": item.get("f8"),
                        "市盈率-动态": item.get("f9"),
                        "最高": item.get("f15"),
                        "最低": item.get("f16"),
                        "今开": item.get("f17"),
                        "昨收": item.get("f18"),
                        "总市值": item.get("f20"),
                        "流通市值": item.get("f21"),
                        "市净率": item.get("f23"),
                        "上市日期": item.get("f26"),
                    })
                return pd.DataFrame(rows)
            except Exception as e:
                last_err = e
                time.sleep(0.35 * (attempt + 1))
    if last_err:
        raise last_err
    return None


def _sina_new_share_frame():
    import akshare as ak
    df = ak.stock_zh_a_new()
    if df is None or len(df) == 0:
        return df
    rename = {
        "code": "代码",
        "name": "名称",
        "open": "今开",
        "high": "最高",
        "low": "最低",
        "volume": "成交量",
        "amount": "成交额",
        "turnoverratio": "换手率",
        "mktcap": "总市值",
        "trade": "最新价",
        "pricechange": "涨跌额",
        "changepercent": "涨跌幅",
        "settlement": "昨收",
    }
    return df.rename(columns={k: v for k, v in rename.items() if k in df.columns})


def _load_new_share_frame():
    try:
        df = _em_new_share_frame()
        if df is not None and len(df) > 0:
            return df
    except Exception:
        pass
    try:
        import akshare as ak
        df = ak.stock_zh_a_new_em()
        if df is not None and len(df) > 0:
            return df
    except Exception:
        pass
    df = _sina_new_share_frame()
    if df is None or len(df) == 0:
        raise ConnectionError("新股行情源暂时连不上，请稍后重试")
    return df


@_guard
def get_new_share_quotes(keyword=None, ts_code=None, limit=None):
    """新股/次新股实时行情。优先东财直连，失败回退 akshare / 新浪。"""
    from fin_agent.datasources.normalize import to_plain_code, to_ts_code

    df = _load_new_share_frame()
    if df is None or len(df) == 0:
        return "暂无新股行情数据"

    mapping = {
        "代码": "symbol",
        "名称": "name",
        "最新价": "price",
        "涨跌额": "change",
        "涨跌幅": "pct_chg",
        "今开": "open",
        "最高": "high",
        "最低": "low",
        "昨收": "pre_close",
        "成交量": "vol",
        "成交额": "amount",
        "换手率": "turnover",
        "市盈率-动态": "pe",
        "市净率": "pb",
        "上市时间": "list_date",
        "上市日期": "list_date",
        "总市值": "total_mv",
        "流通市值": "circ_mv",
    }
    cols = {src: dst for src, dst in mapping.items() if src in df.columns}
    out = df.rename(columns=cols).copy()
    if out.columns.tolist().count("list_date") > 1:
        first = out.iloc[:, [i for i, c in enumerate(out.columns) if c == "list_date"][0]]
        out = out.loc[:, ~out.columns.duplicated()]
        out["list_date"] = first
    if "symbol" not in out.columns:
        return "新股行情接口返回格式异常"

    needle = (str(keyword).strip() if keyword else "") or ""
    code_filter = ""
    if ts_code:
        try:
            code_filter = to_plain_code(to_ts_code(ts_code))
        except ValueError:
            code_filter = str(ts_code).strip()

    if code_filter:
        out = out[out["symbol"].astype(str).str.upper() == code_filter.upper()]
    elif needle:
        mask_code = out["symbol"].astype(str).str.contains(needle, case=False, na=False)
        mask_name = (
            out["name"].astype(str).str.contains(needle, case=False, na=False)
            if "name" in out.columns
            else False
        )
        out = out[mask_code | mask_name]

    if "pct_chg" in out.columns:
        out = out.sort_values("pct_chg", ascending=False, na_position="last")

    try:
        n = int(limit) if limit is not None else _NEW_SHARE_LIMIT_DEFAULT
    except (TypeError, ValueError):
        n = _NEW_SHARE_LIMIT_DEFAULT
    n = max(1, min(n, _NEW_SHARE_LIMIT_MAX))
    out = out.head(n).copy()

    def _to_ts(code):
        try:
            return to_ts_code(code)
        except ValueError:
            return str(code)

    out["ts_code"] = out["symbol"].map(_to_ts)
    for col in _NEW_SHARE_COLUMNS:
        if col not in out.columns:
            out[col] = None
    return df_to_json(out[_NEW_SHARE_COLUMNS])


@_guard
def get_daily_basic(ts_code, start_date=None, end_date=None):
    return df_to_json(get_provider().get_daily_basic(ts_code, start_date, end_date))


@_guard
def get_income_statement(ts_code, start_date=None, end_date=None):
    return df_to_json(get_provider().get_income_statement(ts_code, start_date, end_date))


@_guard
def get_index_daily(ts_code, start_date=None, end_date=None):
    return df_to_json(get_provider().get_index_daily(ts_code, start_date, end_date))
