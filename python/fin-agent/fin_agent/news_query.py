"""按需从 akshare 实时拉取并过滤新闻。"""
import datetime
from typing import Any

import akshare as ak

from fin_agent.datasources.normalize import to_ts_code
from fin_agent.news import (
    AkshareNewsAdapter,
    CHINA_TIMEZONE,
    NewsItem,
    SOURCE_GLOBAL_CLS,
    SOURCE_GLOBAL_EM,
    SOURCE_STOCK_NEWS_EM,
    SUPPORTED_NEWS_SOURCES,
)

_MAX_LIMIT = 50
_MAX_CONSTITUENTS = 30
_DEFAULT_GLOBAL_SOURCES = (SOURCE_GLOBAL_CLS, SOURCE_GLOBAL_EM)


def _parse_published_at(value: str):
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=CHINA_TIMEZONE)
        return parsed.astimezone(CHINA_TIMEZONE)
    except ValueError:
        return None


def _in_time_window(item: NewsItem, *, start_dt, end_dt) -> bool:
    if start_dt is None and end_dt is None:
        return True
    parsed = _parse_published_at(item.published_at)
    if parsed is None:
        return True
    if start_dt is not None and parsed < start_dt:
        return False
    if end_dt is not None and parsed > end_dt:
        return False
    return True


def _match_keywords(text: str, needles: list[str]) -> bool:
    if not needles:
        return True
    hay = (text or "").casefold()
    return all(needle.casefold() in hay for needle in needles)


def _item_text(item: NewsItem) -> str:
    return f"{item.title} {item.summary}"


def _normalize_keywords(query, keywords) -> list[str]:
    needles: list[str] = []
    if query:
        text = str(query).strip()
        if text:
            needles.append(text)
    if keywords:
        if isinstance(keywords, str):
            keywords = [keywords]
        for kw in keywords:
            text = str(kw or "").strip()
            if text:
                needles.append(text)
    return list(dict.fromkeys(needles))


def _resolve_time_window(*, days, hours, start_date, end_date):
    now = datetime.datetime.now(CHINA_TIMEZONE)
    applied: dict[str, Any] = {}

    if start_date or end_date:
        start_dt = None
        end_dt = None
        if start_date:
            start_text = str(start_date).strip()
            start_dt = datetime.datetime.strptime(
                start_text, "%Y-%m-%d"
            ).replace(tzinfo=CHINA_TIMEZONE)
            applied["start_date"] = start_text
        if end_date:
            end_text = str(end_date).strip()
            end_dt = datetime.datetime.combine(
                datetime.datetime.strptime(end_text, "%Y-%m-%d").date(),
                datetime.time(23, 59, 59),
                tzinfo=CHINA_TIMEZONE,
            )
            applied["end_date"] = end_text
        return start_dt, end_dt, applied

    if hours is not None:
        try:
            hour_count = int(hours)
        except (TypeError, ValueError):
            hour_count = None
        if hour_count is not None and hour_count > 0:
            applied["hours"] = hour_count
            return now - datetime.timedelta(hours=hour_count), now, applied

    if days is not None:
        try:
            day_count = int(days)
        except (TypeError, ValueError):
            day_count = None
        if day_count is not None and day_count > 0:
            applied["days"] = day_count
            return now - datetime.timedelta(days=day_count), now, applied

    return None, None, applied


def _resolve_sources(sources, ts_code) -> list[str]:
    if sources:
        if isinstance(sources, str):
            sources = [sources]
        resolved: list[str] = []
        for source in sources:
            name = str(source or "").strip()
            if not name:
                continue
            if name not in SUPPORTED_NEWS_SOURCES:
                raise ValueError(f"不支持的新闻源：{name}")
            if name not in resolved:
                resolved.append(name)
        if not resolved:
            raise ValueError("sources 不能为空")
        return resolved
    if ts_code:
        return [SOURCE_STOCK_NEWS_EM]
    return list(_DEFAULT_GLOBAL_SOURCES)


def _fetch_constituent_codes(sector: str) -> list[str]:
    try:
        frame = ak.stock_board_concept_cons_em(symbol=sector)
    except Exception:
        return []
    if frame is None or getattr(frame, "empty", True):
        return []

    code_col = None
    for column in ("代码", "symbol", "stock_code", "股票代码"):
        if column in frame.columns:
            code_col = column
            break
    if code_col is None:
        return []

    codes: list[str] = []
    seen: set[str] = set()
    for raw in frame[code_col]:
        try:
            ts = to_ts_code(raw)
        except ValueError:
            continue
        if ts in seen:
            continue
        seen.add(ts)
        codes.append(ts)
        if len(codes) >= _MAX_CONSTITUENTS:
            break
    return codes


def _matches_sector(
    item: NewsItem,
    sector: str,
    sector_mode: str,
    constituent_codes: list[str],
) -> bool:
    if not sector:
        return True

    mode = (sector_mode or "both").strip().casefold()
    text_match = sector.casefold() in _item_text(item).casefold()
    symbol_match = False
    if constituent_codes and item.symbols:
        const_set = set(constituent_codes)
        symbol_match = bool(const_set.intersection(item.symbols))

    if mode == "keyword":
        return text_match
    if mode == "constituents":
        return symbol_match
    return text_match or symbol_match


def _dedupe_by_fingerprint(items: list[NewsItem]) -> list[NewsItem]:
    seen: set[str] = set()
    result: list[NewsItem] = []
    for item in items:
        key = item.fingerprint or item.id
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _sort_desc(items: list[NewsItem]) -> list[NewsItem]:
    min_dt = datetime.datetime.min.replace(tzinfo=CHINA_TIMEZONE)

    def sort_key(item: NewsItem):
        parsed = _parse_published_at(item.published_at)
        return parsed or min_dt

    return sorted(items, key=sort_key, reverse=True)


def _item_to_dict(item: NewsItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "summary": item.summary,
        "url": item.url,
        "published_at": item.published_at,
        "source": item.source,
        "symbols": item.symbols,
    }


def query_news_live(
    query=None,
    keywords=None,
    sector=None,
    sector_mode="both",
    ts_code=None,
    sources=None,
    days=None,
    hours=None,
    start_date=None,
    end_date=None,
    limit=20,
) -> dict:
    limit = min(max(int(limit or 20), 1), _MAX_LIMIT)
    normalized_ts_code = None
    if ts_code:
        normalized_ts_code = to_ts_code(ts_code)

    sector_text = str(sector).strip() if sector else ""
    mode = (sector_mode or "both").strip().casefold()
    if mode not in ("keyword", "constituents", "both"):
        raise ValueError('sector_mode 必须是 "keyword"、"constituents" 或 "both"')

    needles = _normalize_keywords(query, keywords)
    start_dt, end_dt, time_applied = _resolve_time_window(
        days=days,
        hours=hours,
        start_date=start_date,
        end_date=end_date,
    )
    resolved_sources = _resolve_sources(sources, normalized_ts_code)

    constituent_codes: list[str] = []
    if sector_text and mode in ("constituents", "both"):
        constituent_codes = _fetch_constituent_codes(sector_text)

    adapter = AkshareNewsAdapter()
    raw_items: list[NewsItem] = []
    fetched_from: list[str] = []

    for source in resolved_sources:
        if source == SOURCE_STOCK_NEWS_EM:
            if not normalized_ts_code:
                continue
            batch = adapter.fetch_stock_symbol(normalized_ts_code)
        else:
            batch = adapter.fetch(source)
        if batch:
            fetched_from.append(source)
        raw_items.extend(batch)

    filtered: list[NewsItem] = []
    for item in raw_items:
        if not _in_time_window(item, start_dt=start_dt, end_dt=end_dt):
            continue
        if not _match_keywords(_item_text(item), needles):
            continue
        if not _matches_sector(item, sector_text, mode, constituent_codes):
            continue
        filtered.append(item)

    deduped = _dedupe_by_fingerprint(filtered)
    sorted_items = _sort_desc(deduped)
    limited = sorted_items[:limit]

    filters_applied: dict[str, Any] = {"limit": limit}
    filters_applied.update(time_applied)
    if normalized_ts_code:
        filters_applied["ts_code"] = normalized_ts_code
    if sector_text:
        filters_applied["sector"] = sector_text
        filters_applied["sector_mode"] = mode
    if needles:
        filters_applied["keywords"] = needles
    if sources:
        filters_applied["sources"] = resolved_sources

    return {
        "items": [_item_to_dict(item) for item in limited],
        "total": len(limited),
        "fetched_from": fetched_from,
        "filters_applied": filters_applied,
    }
