from __future__ import annotations

from fin_agent.alert_history import AlertHistoryStore
from fin_agent.news_store import NotifiedNewsStore
from fin_agent.portfolio import PortfolioManager
from fin_agent.user_profile import UserProfileManager

HS300 = "000300.SH"
HS300_NAME = "沪深300"


def _six_digit(ts_code: str) -> str:
    base = (ts_code or "").split(".", 1)[0].strip()
    return base if base.isdigit() and len(base) == 6 else ""


def _news_text(item: dict) -> str:
    return " ".join(
        [
            str(item.get("title") or ""),
            str(item.get("summary") or ""),
        ]
    )


def _match_holdings(text: str, holdings: list[dict]) -> bool:
    hay = (text or "").lower()
    if not hay:
        return False
    for h in holdings:
        ts_code = str(h.get("ts_code") or "").strip()
        name = str(h.get("name") or "").strip()
        code6 = _six_digit(ts_code)
        if name and name.lower() in hay:
            return True
        if code6 and code6.lower() in hay:
            return True
        if ts_code and ts_code.lower() in hay:
            return True
    return False


def _match_sectors(text: str, sectors: list) -> bool:
    hay = (text or "").lower()
    for s in sectors or []:
        name = str(s or "").strip()
        if name and name.lower() in hay:
            return True
    return False


def _map_local_news(item: dict, match: str) -> dict:
    return {
        "id": item.get("id") or "",
        "title": item.get("title") or "",
        "source": item.get("source") or "",
        "url": item.get("url") or "",
        "match": match,
    }


def _pick_news(holdings: list[dict], sectors: list) -> tuple[str, list]:
    store = NotifiedNewsStore()
    local = store.list_news(offset=0, limit=80).get("items") or []
    if holdings:
        hit = [it for it in local if _match_holdings(_news_text(it), holdings)]
        if hit:
            return "holding", [_map_local_news(it, "holding") for it in hit[:3]]
    if sectors:
        hit = [it for it in local if _match_sectors(_news_text(it), sectors)]
        if hit:
            return "sector", [_map_local_news(it, "sector") for it in hit[:3]]
    if local:
        return "market", [_map_local_news(it, "market") for it in local[:3]]
    try:
        from fin_agent.news_query import query_news_live

        live = query_news_live(hours=24, limit=3)
        items = live.get("items") or []
        out = []
        for it in items[:3]:
            out.append(
                {
                    "id": "",
                    "title": it.get("title") or "",
                    "source": it.get("source") or "",
                    "url": it.get("url") or "",
                    "match": "market",
                }
            )
        return "market", out
    except Exception:
        return "market", []


def _index_snapshot() -> dict | None:
    try:
        from fin_agent.datasources import get_provider

        df = get_provider().get_realtime_price([HS300])
        if df is None or len(df) == 0:
            return None
        row = df.iloc[0]
        price = float(row.get("price") or 0)
        pct = row["pct_chg"] if "pct_chg" in row.index else None
        if pct is None:
            pre = float(row["pre_close"] or 0) if "pre_close" in row.index else 0
            pct = ((price - pre) / pre * 100) if pre else 0.0
        return {
            "ts_code": HS300,
            "name": str(row.get("name") or HS300_NAME),
            "price": round(price, 2),
            "change_pct": round(float(pct or 0), 2),
        }
    except Exception:
        return None


def _today_pnl(positions: list[dict], price_map: dict) -> tuple[float | None, float | None]:
    pnl = 0.0
    used_mv = 0.0
    any_row = False
    for pos in positions:
        ts_code = pos.get("ts_code")
        amount = float(pos.get("amount") or 0)
        quote = price_map.get(ts_code) or {}
        price = float(quote.get("price") or 0)
        pre = float(quote.get("pre_close") or 0)
        if amount <= 0 or price <= 0 or pre <= 0:
            continue
        any_row = True
        pnl += (price - pre) * amount
        used_mv += pre * amount
    if not any_row:
        return None, None
    pct = round(pnl / used_mv * 100, 2) if used_mv else None
    return round(pnl, 2), pct


def build_dashboard_summary(portfolio_id=None) -> dict:
    pm = PortfolioManager()
    listed = pm.list_portfolios()
    requested = (portfolio_id or "").strip() or None
    try:
        status = pm.get_portfolio_status(requested)
    except ValueError:
        status = pm.get_portfolio_status(None)
    positions = status.get("positions") or []
    has_positions = len(positions) > 0
    codes = [p.get("ts_code") for p in positions if p.get("ts_code")]
    price_map = pm._batch_prices(codes) if codes else {}
    today_pnl, today_pct = _today_pnl(positions, price_map) if has_positions else (None, None)

    profile = {}
    try:
        profile = UserProfileManager().get_profile() or {}
    except Exception:
        profile = {}
    sectors = profile.get("favorite_sectors") or []
    news_source, news = _pick_news(positions if has_positions else [], sectors)

    alerts = []
    try:
        raw = AlertHistoryStore().list_items(limit=5)
        for it in raw:
            alerts.append(
                {
                    "id": it.get("id") or "",
                    "message": it.get("message") or "",
                    "triggered_at": it.get("triggered_at") or 0,
                }
            )
    except Exception:
        alerts = []

    snapshot = {
        "portfolio_id": status.get("portfolio_id"),
        "portfolio_name": status.get("portfolio_name"),
        "has_positions": has_positions,
        "total_market_value": None,
        "today_pnl": None,
        "today_pnl_pct": None,
        "total_pnl": None,
        "total_pnl_pct": None,
    }
    if has_positions:
        snapshot["total_market_value"] = status.get("total_market_value")
        snapshot["today_pnl"] = today_pnl
        snapshot["today_pnl_pct"] = today_pct
        snapshot["total_pnl"] = status.get("total_pnl")
        snapshot["total_pnl_pct"] = status.get("total_pnl_pct")

    return {
        "ok": True,
        "portfolios": listed.get("portfolios") or [],
        "active_portfolio_id": listed.get("active_portfolio_id"),
        "snapshot": snapshot,
        "index": _index_snapshot(),
        "news_source": news_source,
        "news": news,
        "alerts": alerts,
    }


COMMENT_PROMPT = """你是 A 股投顾助手。根据给定的大盘涨跌和新闻标题，写一句简体中文市场点评。

硬性要求：
- 只输出一句话，不要列表、不要 Markdown、不要引号包裹全文
- 不超过 80 个汉字
- 只使用下面提供的数据，禁止编造未给出的数字或新闻
- 不要荐股、不要给出买卖指令

组合：{portfolio}
指数：{index_line}
新闻：{news_line}
"""


def generate_dashboard_comment(portfolio_id=None, index=None, news_titles=None) -> dict:
    from fin_agent.config import Config
    from fin_agent.llm.factory import LLMFactory

    Config.load()
    titles = [str(t).strip() for t in (news_titles or []) if str(t).strip()]
    news_line = "；".join(titles) if titles else "无"
    index = index or {}
    name = str(index.get("name") or "沪深300")
    if index.get("change_pct") is None:
        index_line = f"{name} 涨跌未知"
    else:
        index_line = f"{name} {float(index.get('change_pct')):+.2f}%"
    portfolio = str(portfolio_id or "当前组合")
    try:
        llm = LLMFactory.create_llm()
        message = llm.chat(
            [
                {
                    "role": "user",
                    "content": COMMENT_PROMPT.format(
                        portfolio=portfolio,
                        index_line=index_line,
                        news_line=news_line,
                    ),
                }
            ],
            stream=False,
        )
        text = (getattr(message, "content", "") or "").strip()
        text = text.replace("```", "").strip().strip('"“”')
        if len(text) > 80:
            text = text[:80].rstrip()
        if not text:
            return {"ok": False, "error": "点评为空"}
        return {"ok": True, "comment": text}
    except ValueError as e:
        return {"ok": False, "error": "未配置模型" if "Unsupported" in str(e) else str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e) or "点评失败"}
