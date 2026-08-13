import sys
import os
import json
import faulthandler
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from socketserver import ThreadingMixIn
import io
import contextlib
import traceback
import threading
import time

# Enable fault handler to dump traceback on hard crash
faulthandler.enable(file=sys.stderr)

# Set up global exception hook
def global_exception_handler(exc_type, exc_value, exc_traceback):
    """Catch all unhandled exceptions."""
    sys.stderr.write("=" * 80 + "\n")
    sys.stderr.write("UNHANDLED EXCEPTION IN PYTHON PROCESS\n")
    sys.stderr.write("=" * 80 + "\n")
    traceback.print_exception(exc_type, exc_value, exc_traceback, file=sys.stderr)
    sys.stderr.flush()

sys.excepthook = global_exception_handler

# Import debug utility before setting up paths
def debug_print(*args, **kwargs):
    """Print debug message only in API mode."""
    if os.environ.get("FIN_AGENT_API_MODE") == "1":
        print("DEBUG:", *args, **kwargs)
        sys.stdout.flush()

# Force utf-8 encoding for stdout/stderr on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)
except AttributeError:
    # Python < 3.7 might not have reconfigure
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Set env to enable streaming
os.environ["LLM_STREAM"] = "True"
os.environ["FIN_AGENT_API_MODE"] = "1"

# Add current dir to path to import fin_agent
current_dir = os.path.dirname(os.path.abspath(__file__))
# Use insert(0, ...) to prioritize local modules over system installed ones
repo_root = os.path.join(current_dir, "fin-agent")
sys.path.insert(0, repo_root)
sys.path.insert(0, current_dir)

debug_print(f"sys.path[0] = {sys.path[0]}")
if os.path.exists(repo_root):
    debug_print(f"repo_root contents: {os.listdir(repo_root)}")
else:
    debug_print(f"repo_root does not exist: {repo_root}")

try:
    from fin_agent.agent.core import FinAgent
    from fin_agent.config import Config
    from fin_agent.scheduler import TaskScheduler
    from fin_agent import session_store
    from fin_agent.portfolio import PortfolioManager
    from fin_agent.news import SUPPORTED_NEWS_SOURCES
    from fin_agent.news_store import (
        SUBSCRIPTION_TYPES,
        NewsSubscriptionStore,
        NotifiedNewsStore,
    )
    from fin_agent.news_monitor import (
        get_news_monitor,
        start_news_monitor,
        stop_news_monitor,
    )
except ImportError as e:
    print(f"Error importing fin_agent: {e}", file=sys.stderr)
    sys.exit(1)

# Initialize Agent
agent = None

# Notification queue for desktop notifications
notification_queue = []
notification_lock = threading.Lock()
# news_id -> 入队时间戳；只要还在这个集合里就说明该新闻通知已经在
# notification_queue 里等待桌面端 ACK，避免每轮监控周期重复入队同一条。
_ack_pending_news_ids = {}
# 队列硬上限：桌面端长期未启动/未 ACK 时兜底，避免无限堆积。超出后按入队
# 顺序丢弃最旧的条目；被丢弃的新闻仍保留在 NotifiedNewsStore 里
# notification_pending=True，下一轮监控周期会重新尝试入队。
_NOTIFICATION_QUEUE_MAX = 500


def _as_id_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, (list, tuple, set)):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value).strip()
    return [text] if text else []


def _drop_oldest_notifications_if_over_capacity():
    while len(notification_queue) > _NOTIFICATION_QUEUE_MAX:
        dropped = notification_queue.pop(0)
        for news_id in _as_id_list(dropped.get("news_ids")):
            _ack_pending_news_ids.pop(news_id, None)
        news_id = dropped.get("news_id")
        if news_id:
            _ack_pending_news_ids.pop(news_id, None)
        sys.stderr.write(
            f"[Notification] queue over capacity ({_NOTIFICATION_QUEUE_MAX}), "
            f"dropped oldest notification_id={dropped.get('notification_id')}\n"
        )


def enqueue_notification(payload):
    """把新闻 digest 展开为可点击的桌面通知，不经由本机 HTTP 自调用。

    返回值约定（供 NewsMonitor._run_notification_sink 判断能否标记 dispatched）：
    - True：旧版系统通知（价格提醒等），无需 ACK，入队即视为已投递；
    - {"ack_required": True}：新闻通知只是入队，真正的“已送达”以桌面端
      调用 POST /notifications/ack 为准，调用方不得据此标记 dispatched。

    展开规则：
    1. 同一新闻命中多个订阅只保留一条，主订阅取首次出现；
    2. 按主订阅聚合：本轮仅 1 条 → 直接展示标题；
       同一订阅本轮 ≥2 条 → 合并为「新增 N 条新闻：代表标题」。
    """
    if payload.get("type") != "news_digest":
        with notification_lock:
            notification_queue.append(dict(payload))
            _drop_oldest_notifications_if_over_capacity()
        return True

    def _sentiment_of(item):
        value = (item or {}).get("sentiment")
        if value in ("bullish", "bearish", "neutral"):
            return value
        return None

    def _sentiment_counts(entries):
        counts = {"bullish": 0, "bearish": 0, "neutral": 0, "unknown": 0}
        for entry in entries:
            key = _sentiment_of(entry.get("item")) or "unknown"
            counts[key] = counts.get(key, 0) + 1
        return counts

    def _single_body(item):
        title = (item.get("title") or "").strip()
        summary = (item.get("summary") or "").strip()
        if title and summary and summary != title:
            # 标题 + 摘要，供大号 Toast 多行展示
            return f"{title}\n{summary[:180]}"
        return title or summary or "有新的订阅新闻"

    def _merged_body(entries, counts):
        parts = []
        label_map = {"bullish": "利好", "bearish": "利空", "neutral": "中性"}
        for entry in entries[:6]:
            item = entry.get("item") or {}
            title = (item.get("title") or item.get("summary") or "未命名新闻").strip()
            tag = label_map.get(_sentiment_of(item) or "", "")
            parts.append(f"[{tag}] {title}" if tag else title)
        if len(entries) > 6:
            parts.append(f"…另有 {len(entries) - 6} 条")
        return "\n".join(parts)

    # 先按 news_id 去重，保留全部命中订阅；主订阅 = 首次出现的订阅。
    by_news_id = {}
    for group in payload.get("groups") or []:
        subscription_id = group.get("subscription_id")
        subscription_name = group.get("subscription_name") or "新闻订阅"
        for item in group.get("items") or []:
            news_id = item.get("id")
            if not news_id:
                continue
            entry = by_news_id.setdefault(news_id, {
                "item": item,
                "subscription_ids": [],
                "subscription_names": [],
            })
            if subscription_id and subscription_id not in entry["subscription_ids"]:
                entry["subscription_ids"].append(subscription_id)
            if subscription_name and subscription_name not in entry["subscription_names"]:
                entry["subscription_names"].append(subscription_name)

    # 再按主订阅聚合，用于单条/合并通知决策。
    by_primary_subscription = {}
    for news_id, entry in by_news_id.items():
        subscription_ids = entry["subscription_ids"]
        subscription_names = entry["subscription_names"]
        primary_id = subscription_ids[0] if subscription_ids else None
        primary_name = subscription_names[0] if subscription_names else "新闻订阅"
        bucket_key = primary_id or f"__ungrouped__:{news_id}"
        bucket = by_primary_subscription.setdefault(bucket_key, {
            "subscription_id": primary_id,
            "subscription_name": primary_name,
            "entries": [],
        })
        bucket["entries"].append({
            "news_id": news_id,
            "item": entry["item"],
            "subscription_ids": subscription_ids,
            "subscription_names": subscription_names,
        })

    with notification_lock:
        now = time.time()
        for bucket in by_primary_subscription.values():
            fresh_entries = [
                entry for entry in bucket["entries"]
                if entry["news_id"] not in _ack_pending_news_ids
            ]
            if not fresh_entries:
                continue

            subscription_id = bucket["subscription_id"]
            subscription_name = bucket["subscription_name"] or "新闻订阅"

            if len(fresh_entries) == 1:
                entry = fresh_entries[0]
                news_id = entry["news_id"]
                item = entry["item"]
                subscription_ids = entry["subscription_ids"]
                sentiment = _sentiment_of(item)
                notification_queue.append({
                    "notification_id": f"news:{news_id}",
                    "notification_ids": [f"news:{news_id}"],
                    "type": "news",
                    "title": subscription_name,
                    "body": _single_body(item),
                    "timestamp": now,
                    "news_id": news_id,
                    "news_ids": [news_id],
                    "merged": False,
                    "news_count": 1,
                    "sentiment": sentiment,
                    "sentiment_counts": {
                        "bullish": 1 if sentiment == "bullish" else 0,
                        "bearish": 1 if sentiment == "bearish" else 0,
                        "neutral": 1 if sentiment == "neutral" else 0,
                        "unknown": 0 if sentiment else 1,
                    },
                    "subscription_id": subscription_id,
                    "subscription_ids": subscription_ids,
                    "source": item.get("source"),
                    "url": item.get("url"),
                    "ack_required": True,
                })
                _ack_pending_news_ids[news_id] = now
                continue

            news_ids = [entry["news_id"] for entry in fresh_entries]
            notification_ids = [f"news:{news_id}" for news_id in news_ids]
            first_item = fresh_entries[0]["item"]
            counts = _sentiment_counts(fresh_entries)
            all_subscription_ids = []
            for entry in fresh_entries:
                for sid in entry["subscription_ids"]:
                    if sid not in all_subscription_ids:
                        all_subscription_ids.append(sid)
            merge_token = subscription_id or news_ids[0]
            bullish = counts.get("bullish", 0)
            bearish = counts.get("bearish", 0)
            count_bits = []
            if bullish:
                count_bits.append(f"利好{bullish}")
            if bearish:
                count_bits.append(f"利空{bearish}")
            merge_title = f"{subscription_name} · 新增 {len(fresh_entries)} 条"
            if count_bits:
                merge_title = f"{merge_title}（{'/'.join(count_bits)}）"
            notification_queue.append({
                "notification_id": f"news-merge:{merge_token}:{int(now * 1000)}",
                "notification_ids": notification_ids,
                "type": "news",
                "title": merge_title,
                "body": _merged_body(fresh_entries, counts),
                "timestamp": now,
                "news_id": None,
                "news_ids": news_ids,
                "merged": True,
                "news_count": len(fresh_entries),
                "sentiment": None,
                "sentiment_counts": counts,
                "subscription_id": subscription_id,
                "subscription_ids": all_subscription_ids or (
                    [subscription_id] if subscription_id else []
                ),
                "source": first_item.get("source"),
                "url": None,
                "ack_required": True,
            })
            for news_id in news_ids:
                _ack_pending_news_ids[news_id] = now
        _drop_oldest_notifications_if_over_capacity()
    return {"ack_required": True}


def ack_notifications(notification_ids, news_ids):
    """幂等地把已 ACK 的通知从队列中移除，返回应标记为已投递的 news_id 集合。

    即便队列里已经找不到对应条目（例如重复 ACK，或 Python 进程重启后队列
    为空），显式传入的 news_id 依然会被返回，交给调用方尝试标记历史存储，
    以保证幂等——重复调用不会报错，也不会产生副作用。
    """
    notification_id_set = set(notification_ids)
    resolved_news_ids = set(news_ids)
    with notification_lock:
        remaining = []
        for entry in notification_queue:
            entry_ids = set(entry.get("notification_ids") or [])
            if entry.get("notification_id"):
                entry_ids.add(entry["notification_id"])
            entry_news_ids = set(_as_id_list(entry.get("news_ids")))
            if entry.get("news_id"):
                entry_news_ids.add(entry["news_id"])
            matched = bool(entry_ids & notification_id_set) or (
                bool(entry_news_ids & resolved_news_ids)
            )
            if matched:
                resolved_news_ids.update(entry_news_ids)
                continue
            remaining.append(entry)
        notification_queue[:] = remaining
        for news_id in resolved_news_ids:
            _ack_pending_news_ids.pop(news_id, None)
    return resolved_news_ids


def init_agent():
    global agent
    try:
        # Ensure config is loaded
        Config.load()
        debug_print("Config loaded.")
        debug_print(f"LLM_PROVIDER = {Config.LLM_PROVIDER}")
        debug_print(f"TUSHARE_TOKEN is set: {bool(Config.TUSHARE_TOKEN)}")
        
        # We attempt initialization. If it fails due to config, we might handle it.
        debug_print("Creating FinAgent instance...")
        agent = FinAgent()
        debug_print("FinAgent instance created")
        print("Agent initialized successfully.")
        
        # Start backend scheduler
        try:
            scheduler = TaskScheduler()
            scheduler.set_notification_sink(enqueue_notification)
            scheduler.start()
            debug_print("Background scheduler started.")
            print("Background scheduler started.")
        except Exception as e:
            debug_print(f"Warning: Failed to start scheduler: {e}")
            sys.stderr.write(f"Warning: Failed to start scheduler: {e}\n")
            sys.stderr.flush()
    except Exception as e:
        import traceback
        error_msg = f"Error initializing agent: {e}\n{traceback.format_exc()}"
        sys.stderr.write(error_msg + "\n")
        sys.stderr.flush()
        agent = None

def build_session_agent(session_id):
    """为一次请求构建独立的 FinAgent 实例，并注入该会话的历史。

    FinAgent.__init__ 只构造 LLM 客户端并读取一次用户画像，开销可忽略，
    因此每请求新建实例即可让多个标签真正并行生成。
    """
    Config.load()
    agent_instance = FinAgent()
    try:
        body = session_store.get_session(session_id)
    except KeyError:
        # 请求的 session_id 尚无正文：空历史起步，写回时由 save_llm_history/_touch 建索引
        body = {"llm_history": []}
    history = body.get("llm_history") or []
    if history:
        agent_instance.history = history
    return agent_instance

TITLE_PROMPT = (
    "请用不超过 12 个汉字概括下面这句用户提问的主题，只输出标题本身，"
    "不要引号、不要标点、不要解释。\n\n用户提问：{question}"
)


def _fallback_title(user_input):
    text = (user_input or "").strip().replace("\n", " ")
    return text[:20] or session_store.DEFAULT_TITLE


def maybe_generate_title(session_id, user_input):
    """首轮对话结束后生成标题。仅在标题仍为默认值时执行。"""
    def worker():
        try:
            listing = session_store.list_sessions(offset=0, limit=500)
            entry = next((e for e in listing["sessions"] if e["id"] == session_id), None)
            if entry is None or entry.get("title") != session_store.DEFAULT_TITLE:
                return

            title = _fallback_title(user_input)
            try:
                from fin_agent.llm.factory import LLMFactory
                llm = LLMFactory.create_llm()
                # chat(stream=False) 返回 response.choices[0].message 对象，取 .content
                message = llm.chat(
                    [{"role": "user", "content": TITLE_PROMPT.format(question=user_input)}],
                    stream=False,
                )
                candidate = (getattr(message, "content", "") or "").strip().strip('"').strip("'").replace("\n", "")
                if candidate:
                    title = candidate[:20]
            except Exception as e:
                sys.stderr.write(f"[Title] LLM summarize failed, fallback to truncation: {e}\n")
                sys.stderr.flush()

            session_store.rename_session(session_id, title)
        except Exception as e:
            sys.stderr.write(f"[Title] Failed to set session title: {e}\n")
            sys.stderr.flush()

    threading.Thread(target=worker, daemon=True).start()

class ApiError(Exception):
    """handler 抛出此异常以返回非 200 响应。"""
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class ApiRequest:
    """统一的请求载体。GET 用 query，POST 用 body。"""
    def __init__(self, path, query, body):
        self.path = path
        self.query = query
        self.body = body


# 端点注册表：(HTTP 方法, 路径) -> handler(ApiRequest) -> dict
ROUTES = {}


def route(method, path):
    """装饰器：把 handler 注册进 ROUTES。"""
    def decorator(func):
        ROUTES[(method, path)] = func
        return func
    return decorator


# 新闻写 API 的 CSRF 边界：仅对 POST /news/* 与 POST /notifications/ack 生效，
# 不影响 /chat、/config/save、/sessions/*、/portfolio/* 等既有端点。
_CSRF_PROTECTED_EXACT_PATHS = {"/notifications/ack"}
_CSRF_PROTECTED_PREFIXES = ("/news/",)


def _is_csrf_protected_path(path):
    if path in _CSRF_PROTECTED_EXACT_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in _CSRF_PROTECTED_PREFIXES)


@route("GET", "/profile")
def handle_profile_get(req):
    from fin_agent.tools.profile_tools import get_profile_manager
    pm = get_profile_manager()
    return {"profile": pm.get_profile(), "completeness": pm.completeness()}


@route("POST", "/profile")
def handle_profile_save(req):
    from fin_agent.tools.profile_tools import get_profile_manager
    pm = get_profile_manager()
    body = req.body or {}
    try:
        pm.update_profile(
            risk_tolerance=body.get("risk_tolerance"),
            investment_horizon=body.get("investment_horizon"),
            favorite_sectors=body.get("favorite_sectors"),
            avoid_sectors=body.get("avoid_sectors"),
            investment_style=body.get("investment_style"),
            experience_level=body.get("experience_level"),
        )
    except ValueError as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "profile": pm.get_profile(), "completeness": pm.completeness()}


@route("GET", "/config")
def handle_get_config(req):
    Config.load()
    return {
        "tushare_token": Config.TUSHARE_TOKEN or "",
        "provider": Config.LLM_PROVIDER or "deepseek",
        "deepseek_key": Config.DEEPSEEK_API_KEY or "",
        "deepseek_base": Config.DEEPSEEK_BASE_URL or "https://api.deepseek.com",
        "deepseek_model": Config.DEEPSEEK_MODEL or "deepseek-chat",
        "openai_key": Config.OPENAI_API_KEY or "",
        "openai_base": Config.OPENAI_BASE_URL or "",
        "openai_model": Config.OPENAI_MODEL or "",
        "wake_up_shortcut": Config.WAKE_UP_SHORTCUT or "Ctrl+Alt+Q",
        "email_server": Config.EMAIL_SMTP_SERVER or "",
        "email_port": str(Config.EMAIL_SMTP_PORT) if Config.EMAIL_SMTP_PORT else "465",
        "email_sender": Config.EMAIL_SENDER or "",
        "email_password": Config.EMAIL_PASSWORD or "",
        "email_receiver": Config.EMAIL_RECEIVER or "",
        "data_source": Config.DATA_SOURCE or "akshare",
        "alert_poll_interval_minutes": Config.ALERT_POLL_INTERVAL_MINUTES,
        "alert_trading_hours_only": Config.ALERT_TRADING_HOURS_ONLY,
        "news_poll_interval_minutes": Config.NEWS_POLL_INTERVAL_MINUTES,
        "news_sentiment_enabled": Config.NEWS_SENTIMENT_ENABLED,
    }


@route("GET", "/notifications/poll")
def handle_notifications_poll(req):
    """轮询桌面通知。

    需要 ACK 的新闻通知（ack_required=True）取出后仍保留在队列中，直到
    桌面端显式调用 POST /notifications/ack 才移除，从而支持“展示后崩溃/
    ACK 失败”场景下一轮的重试；旧版系统通知维持取出即清空的行为。
    """
    with notification_lock:
        ack_required = [n for n in notification_queue if n.get("ack_required")]
        legacy = [n for n in notification_queue if not n.get("ack_required")]
        notification_queue[:] = ack_required
    return {"notifications": legacy + ack_required}


@route("POST", "/notifications/ack")
def handle_notifications_ack(req):
    """桌面端展示通知后（或因本地去重跳过展示）调用，确认已送达。幂等。"""
    notification_ids = _as_id_list(req.body.get("notification_ids"))
    news_ids = _as_id_list(req.body.get("news_ids"))
    resolved_news_ids = ack_notifications(notification_ids, news_ids)
    changed = 0
    if resolved_news_ids:
        changed = _news_history_store().mark_notifications_dispatched(
            list(resolved_news_ids)
        )
    return {
        "success": True,
        "acknowledged": sorted(resolved_news_ids),
        "changed": changed,
    }


@route("POST", "/notifications/test")
def handle_notifications_test(req):
    """手动入队一条测试桌面通知，便于验证浮窗显示与点击跳转。"""
    body = req.body or {}
    now = time.time()
    nid = body.get("notification_id") or f"test_toast_{int(now * 1000)}"
    ntype = body.get("type") or "price_alert"
    payload = {
        "notification_id": nid,
        "notification_ids": body.get("notification_ids") or [nid],
        "type": ntype,
        "title": body.get("title") or "测试桌面通知",
        "body": body.get("body") or "如果你能看到这条，飞书式浮窗已生效",
        "timestamp": now,
        "task_id": body.get("task_id"),
        "ts_code": body.get("ts_code"),
        "news_id": body.get("news_id"),
        "news_ids": body.get("news_ids"),
        "subscription_id": body.get("subscription_id"),
        "subscription_ids": body.get("subscription_ids"),
        "source": body.get("source"),
        "url": body.get("url"),
        "merged": bool(body.get("merged")),
        "news_count": body.get("news_count"),
        "sentiment": body.get("sentiment"),
        "sentiment_counts": body.get("sentiment_counts"),
        "ack_required": bool(body.get("ack_required")),
        # 仅测试用：让 Electron 弹出更新浮窗
        "update": body.get("update"),
    }
    enqueue_notification(payload)
    return {"success": True, "notification_id": nid, "type": ntype}


@route("GET", "/config/check")
def handle_config_check(req):
    try:
        Config.validate()
        return {"configured": True, "message": []}
    except ValueError as e:
        return {"configured": False, "message": str(e)}


@route("GET", "/scheduler/tasks")
def handle_scheduler_tasks(req):
    scheduler = TaskScheduler()
    return {"tasks": scheduler.list_tasks_enriched()}


@route("POST", "/notification")
def handle_notification(req):
    title = req.body.get('title', 'Fin-Agent 提醒')
    body = req.body.get('body', '')
    notification = dict(req.body)
    notification.update({
        "title": title,
        "body": body,
        "timestamp": req.body.get("timestamp", time.time()),
    })
    with notification_lock:
        notification_queue.append(notification)
    debug_print(f"Desktop notification queued: {title} - {body}")
    return {"success": True}


@route("POST", "/config/save")
def handle_config_save(req):
    data = req.body
    Config.update_core_config(
        data.get('tushare_token', ''),
        data.get('provider', 'deepseek'),
        data.get('deepseek_key', ''),
        data.get('deepseek_base', 'https://api.deepseek.com'),
        data.get('deepseek_model', 'deepseek-chat'),
        data.get('openai_key', ''),
        data.get('openai_base', ''),
        data.get('openai_model', ''),
        data.get('wake_up_shortcut', 'Ctrl+Alt+Q')
    )

    email_server = data.get('email_server', '')
    email_sender = data.get('email_sender', '')
    if email_server and email_sender:
        Config.update_email_config(
            email_server,
            data.get('email_port', '465'),
            email_sender,
            data.get('email_password', ''),
            data.get('email_receiver', '')
        )

    Config.update_app_settings(
        data.get('data_source', 'akshare'),
        data.get('alert_poll_interval_minutes', 10),
        data.get('alert_trading_hours_only', True),
        data.get('news_poll_interval_minutes'),
        data.get('news_sentiment_enabled'),
    )

    if Config.NEWS_SENTIMENT_ENABLED:
        try:
            from fin_agent.news_sentiment import get_sentiment_labeler
            get_sentiment_labeler().enqueue_backlog(_news_history_store(), limit=30)
        except Exception as exc:
            sys.stderr.write(f"[Config] sentiment backlog enqueue failed: {exc}\n")
            sys.stderr.flush()

    from fin_agent.datasources import reset_provider_cache
    reset_provider_cache()

    init_agent()
    return {"success": True, "path": Config.get_env_path()}


def _query_bool(value, default=None):
    if value is None:
        return default
    normalized = str(value).strip().casefold()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    raise ApiError(400, "布尔参数必须为 true 或 false")


def _news_subscription_store():
    return NewsSubscriptionStore()


def _news_history_store():
    return NotifiedNewsStore()


@route("GET", "/news/subscriptions")
def handle_news_subscriptions(req):
    enabled = _query_bool(req.query.get("enabled"))
    subscription_type = req.query.get("type") or None
    if subscription_type and subscription_type not in SUBSCRIPTION_TYPES:
        raise ApiError(400, f"不支持的订阅类型：{subscription_type}")
    return {
        "subscriptions": _news_subscription_store().list_subscriptions(
            enabled=enabled,
            subscription_type=subscription_type,
        )
    }


@route("POST", "/news/subscriptions/create")
def handle_news_subscription_create(req):
    subscription_type = req.body.get("type")
    if not subscription_type:
        raise ApiError(400, "missing type")
    try:
        item = _news_subscription_store().create_subscription(
            subscription_type=subscription_type,
            name=req.body.get("name"),
            keywords=req.body.get("keywords"),
            exclude_keywords=req.body.get("exclude_keywords"),
            sources=req.body.get("sources"),
            enabled=req.body.get("enabled", True),
            symbols=req.body.get("symbols"),
        )
    except ValueError as e:
        raise ApiError(400, str(e))
    return {"success": True, "subscription": item}


@route("POST", "/news/subscriptions/update")
def handle_news_subscription_update(req):
    subscription_id = req.body.get("id")
    if not subscription_id:
        raise ApiError(400, "missing id")
    changes = {
        key: req.body[key]
        for key in (
            "name", "enabled", "keywords", "exclude_keywords", "sources", "symbols",
        )
        if key in req.body
    }
    try:
        item = _news_subscription_store().update_subscription(
            subscription_id, **changes
        )
    except ValueError as e:
        raise ApiError(400, str(e))
    if item is None:
        raise ApiError(404, "subscription not found")
    return {"success": True, "subscription": item}


@route("POST", "/news/subscriptions/delete")
def handle_news_subscription_delete(req):
    subscription_id = req.body.get("id")
    if not subscription_id:
        raise ApiError(400, "missing id")
    if not _news_subscription_store().delete_subscription(subscription_id):
        raise ApiError(404, "subscription not found")
    return {"success": True, "deleted": True}


@route("POST", "/news/subscriptions/toggle")
def handle_news_subscription_toggle(req):
    subscription_id = req.body.get("id")
    if not subscription_id or "enabled" not in req.body:
        raise ApiError(400, "missing id or enabled")
    item = _news_subscription_store().set_enabled(
        subscription_id, bool(req.body["enabled"])
    )
    if item is None:
        raise ApiError(404, "subscription not found")
    return {"success": True, "subscription": item}


@route("GET", "/news")
def handle_news_list(req):
    try:
        page = max(int(req.query.get("page", 1)), 1)
        page_size = min(max(int(req.query.get("page_size", 50)), 1), 200)
    except ValueError:
        raise ApiError(400, "page/page_size 必须为整数")
    source = req.query.get("source") or None
    subscription_type = req.query.get("type") or None
    if source and source not in SUPPORTED_NEWS_SOURCES:
        raise ApiError(400, f"不支持的新闻源：{source}")
    if subscription_type and subscription_type not in SUBSCRIPTION_TYPES:
        raise ApiError(400, f"不支持的订阅类型：{subscription_type}")
    result = _news_history_store().list_news(
        source=source,
        unread_only=_query_bool(req.query.get("unread"), False),
        subscription_id=req.query.get("subscription_id") or None,
        subscription_type=subscription_type,
        query=req.query.get("query") or None,
        symbol=req.query.get("symbol") or None,
        news_id=req.query.get("id") or None,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    return {
        "items": result["items"],
        "total": result["total"],
        "page": page,
        "page_size": page_size,
        "has_more": page * page_size < result["total"],
    }


@route("GET", "/news/unread-count")
def handle_news_unread_count(req):
    return {"count": _news_history_store().unread_count()}


@route("POST", "/news/mark-read")
def handle_news_mark_read(req):
    news_id = req.body.get("id")
    if not news_id:
        raise ApiError(400, "missing id")
    found = _news_history_store().mark_read(
        news_id, read=req.body.get("read", True)
    )
    if not found:
        raise ApiError(404, "news not found")
    return {"success": True}


@route("POST", "/news/mark-read-batch")
def handle_news_mark_read_batch(req):
    news_ids = req.body.get("ids")
    if not isinstance(news_ids, list) or not news_ids:
        raise ApiError(400, "ids 必须为非空数组")
    changed = _news_history_store().mark_read_many(
        news_ids, read=req.body.get("read", True)
    )
    return {"success": True, "changed": changed}


@route("POST", "/news/mark-all-read")
def handle_news_mark_all_read(req):
    return {
        "success": True,
        "changed": _news_history_store().mark_all_read(),
    }


@route("POST", "/news/clear")
def handle_news_clear(req):
    return {"success": True, "cleared": _news_history_store().clear()}


@route("GET", "/news/monitor/status")
def handle_news_monitor_status(req):
    from fin_agent.news_store import NewsMonitorStateStore

    Config.load()
    monitor = get_news_monitor()
    if monitor is None:
        return {
            "running": False,
            "cycle_running": False,
            "closed": True,
            "poll_interval_minutes": Config.NEWS_POLL_INTERVAL_MINUTES,
            "last_started_at": None,
            "last_completed_at": None,
            "last_error": None,
            "source_health": NewsMonitorStateStore().get_source_health(),
        }
    return monitor.status()


@route("POST", "/news/refresh")
def handle_news_refresh(req):
    monitor = get_news_monitor() or start_news_monitor(enqueue_notification)
    try:
        accepted = monitor.refresh()
    except RuntimeError as e:
        raise ApiError(409, str(e))
    return {
        "success": True,
        "accepted": accepted,
        "status": monitor.status(),
    }


@route("POST", "/scheduler/tasks/remove")
def handle_scheduler_task_remove(req):
    task_id = req.body.get('task_id')
    if not task_id:
        raise ApiError(400, "missing task_id")
    scheduler = TaskScheduler()
    return {"success": True, "removed": scheduler.remove_task(task_id)}


@route("GET", "/sessions")
def handle_list_sessions(req):
    try:
        offset = int(req.query.get("offset", 0))
        limit = int(req.query.get("limit", 30))
    except ValueError:
        raise ApiError(400, "offset/limit 必须为整数")
    return session_store.list_sessions(offset=max(offset, 0), limit=min(max(limit, 1), 200))


@route("GET", "/sessions/detail")
def handle_session_detail(req):
    session_id = req.query.get("id")
    if not session_id:
        raise ApiError(400, "missing id")
    try:
        return session_store.get_session(session_id)
    except KeyError:
        raise ApiError(404, "session not found")


@route("POST", "/sessions/create")
def handle_session_create(req):
    return session_store.create_session(req.body.get("title") or session_store.DEFAULT_TITLE)


@route("POST", "/sessions/delete")
def handle_session_delete(req):
    session_id = req.body.get("id")
    if not session_id:
        raise ApiError(400, "missing id")
    return {"success": True, "deleted": session_store.delete_session(session_id)}


@route("POST", "/sessions/rename")
def handle_session_rename(req):
    session_id = req.body.get("id")
    title = req.body.get("title")
    if not session_id or not title:
        raise ApiError(400, "missing id or title")
    if not session_store.rename_session(session_id, title):
        raise ApiError(404, "session not found")
    return {"success": True}


@route("POST", "/sessions/pin")
def handle_session_pin(req):
    session_id = req.body.get("id")
    if not session_id:
        raise ApiError(400, "missing id")
    if not session_store.set_pinned(session_id, bool(req.body.get("pinned"))):
        raise ApiError(404, "session not found")
    return {"success": True}


@route("POST", "/sessions/search")
def handle_session_search(req):
    return session_store.search_sessions(req.body.get("keyword", ""))


@route("POST", "/sessions/ui")
def handle_session_save_ui(req):
    session_id = req.body.get("id")
    if not session_id:
        raise ApiError(400, "missing id")
    session_store.save_ui_messages(session_id, req.body.get("ui_messages") or [])
    return {"success": True}


def _portfolio_result(message):
    """PortfolioManager 用字符串前缀表达错误，这里转成结构化响应。"""
    if isinstance(message, str) and message.startswith("Error:"):
        raise ApiError(400, message[len("Error:"):].strip())
    return {"success": True, "message": message}


@route("GET", "/portfolio/list")
def handle_portfolio_list(req):
    return PortfolioManager().list_portfolios()


@route("GET", "/portfolio/detail")
def handle_portfolio_detail(req):
    try:
        return PortfolioManager().get_portfolio_status(req.query.get("id") or None)
    except ValueError as e:
        raise ApiError(404, str(e))


@route("POST", "/portfolio/create")
def handle_portfolio_create(req):
    result = PortfolioManager().create_portfolio(req.body.get("name"))
    if isinstance(result, str) and result.startswith("Error:"):
        raise ApiError(400, result[len("Error:"):].strip())
    return {"success": True, "id": result}


@route("POST", "/portfolio/rename")
def handle_portfolio_rename(req):
    try:
        return _portfolio_result(
            PortfolioManager().rename_portfolio(req.body.get("id"), req.body.get("name"))
        )
    except ValueError as e:
        raise ApiError(404, str(e))


@route("POST", "/portfolio/delete")
def handle_portfolio_delete(req):
    try:
        return _portfolio_result(PortfolioManager().delete_portfolio(req.body.get("id")))
    except ValueError as e:
        raise ApiError(404, str(e))


@route("POST", "/portfolio/position/add")
def handle_position_add(req):
    body = req.body
    try:
        return _portfolio_result(PortfolioManager().create_position(
            body.get("ts_code"),
            int(body.get("amount", 0)),
            float(body.get("cost", 0)),
            body.get("bought_at", ""),
            body.get("note", ""),
            portfolio=body.get("id") or None,
        ))
    except ValueError as e:
        raise ApiError(400, str(e))


@route("POST", "/portfolio/position/update")
def handle_position_update(req):
    body = req.body
    try:
        return _portfolio_result(PortfolioManager().update_position(
            body.get("ts_code"),
            int(body.get("amount", 0)),
            float(body.get("cost", 0)),
            body.get("bought_at", ""),
            body.get("note", ""),
            portfolio=body.get("id") or None,
        ))
    except ValueError as e:
        raise ApiError(400, str(e))


@route("POST", "/portfolio/position/delete")
def handle_position_delete(req):
    try:
        return _portfolio_result(
            PortfolioManager().delete_position(req.body.get("ts_code"), portfolio=req.body.get("id") or None)
        )
    except ValueError as e:
        raise ApiError(404, str(e))


# --- 股票详情页市场读接口（结构化 JSON，不走 Agent 工具） ---

@route("GET", "/market/search")
def handle_market_search(req):
    from fin_agent import api_market
    Config.load()
    return api_market.search_stocks(req.query.get("q") or "")


@route("GET", "/market/quote")
def handle_market_quote(req):
    from fin_agent import api_market
    Config.load()
    return api_market.get_quote(req.query.get("ts_code") or "")


@route("GET", "/market/kline")
def handle_market_kline(req):
    from fin_agent import api_market
    Config.load()
    return api_market.get_kline(
        req.query.get("ts_code") or "",
        period=req.query.get("period") or "6M",
    )


@route("GET", "/market/valuation")
def handle_market_valuation(req):
    from fin_agent import api_market
    Config.load()
    return api_market.get_valuation(req.query.get("ts_code") or "")


@route("GET", "/market/financials")
def handle_market_financials(req):
    from fin_agent import api_market
    Config.load()
    return api_market.get_financials(req.query.get("ts_code") or "")


@route("GET", "/market/moneyflow")
def handle_market_moneyflow(req):
    from fin_agent import api_market
    Config.load()
    return api_market.get_moneyflow(req.query.get("ts_code") or "")


class RequestHandler(BaseHTTPRequestHandler):
    # Increase buffer sizes
    rbufsize = -1  # Use buffered reading
    wbufsize = 0   # No buffering for writing (immediate flush)
    
    def log_message(self, format, *args):
        """Override to add more detailed logging."""
        # Skip logging for notification polling to reduce noise
        if self.path != '/notifications/poll':
            sys.stderr.write(f"[HTTP] {format % args}\n")
            sys.stderr.flush()
    
    def log_error(self, format, *args):
        """Override to log errors to stderr."""
        sys.stderr.write(f"[HTTP ERROR] {format % args}\n")
        sys.stderr.flush()
    
    def __init__(self, *args, **kwargs):
        try:
            BaseHTTPRequestHandler.__init__(self, *args, **kwargs)
        except Exception as e:
            sys.stderr.write(f"[HTTP] Error in __init__: {e}\n")
            import traceback
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()
            raise
    
    def handle(self):
        """Override handle to add error catching."""
        try:
            BaseHTTPRequestHandler.handle(self)
        except Exception as e:
            sys.stderr.write(f"[HTTP] Error in handle(): {e}\n")
            import traceback
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()
    
    def handle_one_request(self):
        """Override to add error catching."""
        try:
            BaseHTTPRequestHandler.handle_one_request(self)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError) as e:
            # 客户端断开连接（用户主动停止），静默处理，不打印错误
            # Close the connection
            self.close_connection = True
        except Exception as e:
            # 检查是否是连接相关的错误（用户主动停止）
            if isinstance(e, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)):
                # 用户主动停止，静默处理
                self.close_connection = True
            else:
                # 真正的错误，才打印日志
                sys.stderr.write(f"[HTTP] Error in handle_one_request(): {e}\n")
                import traceback
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
                # Close the connection
                self.close_connection = True
    
    def _send_json(self, status, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        handler = ROUTES.get((method, parsed.path))
        if handler is None:
            self.send_response(404)
            self.end_headers()
            return
        try:
            if method == 'POST' and _is_csrf_protected_path(parsed.path):
                content_type = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
                if content_type != 'application/json':
                    raise ApiError(415, "Content-Type must be application/json")
                # Electron 主进程用 Node http 客户端直连本机 API，不会带 Origin；
                # 带非空 Origin 的请求视为浏览器发起的跨域调用，一律拒绝。
                if self.headers.get('Origin'):
                    raise ApiError(403, "Cross-origin requests are not allowed")
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            body = {}
            if method == 'POST':
                length = int(self.headers.get('Content-Length', 0))
                # 空 body 必须挡在 handler 之前：/config/save 拿到空字典会用一串
                # 空字符串覆盖用户的 .env。字段全可选的端点也应显式发 {}。
                if not length:
                    raise ApiError(400, "Missing request body")
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            result = handler(ApiRequest(parsed.path, query, body))
            self._send_json(200, result)
        except ApiError as e:
            self._send_json(e.status, {"success": False, "error": e.message})
        except json.JSONDecodeError:
            self._send_json(400, {"success": False, "error": "Invalid JSON"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            self.close_connection = True
        except Exception as e:
            sys.stderr.write(f"[HTTP] handler error on {parsed.path}: {e}\n{traceback.format_exc()}\n")
            sys.stderr.flush()
            self._send_json(500, {"error": str(e), "trace": traceback.format_exc()})

    def do_GET(self):
        self._dispatch('GET')

    def do_POST(self):
        try:
            if self.path == '/chat':
                self._handle_chat_stream()
            else:
                self._dispatch('POST')
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        except Exception as e:
            sys.stderr.write(f"Fatal error in do_POST: {e}\n{traceback.format_exc()}\n")
            sys.stderr.flush()

    def _handle_chat_stream(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
             self.send_response(400)
             self.end_headers()
             self.wfile.write(b"Missing Content-Length")
             return
             
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
            user_input = data.get('message')
            debug_print(f"User input: {user_input}")

            session_id = data.get('session_id')
            if session_id:
                active_agent = build_session_agent(session_id)
            else:
                if not agent:
                    debug_print("Agent not initialized, trying to init...")
                    init_agent()
                active_agent = agent

            if not active_agent:
                 debug_print("Agent init failed, returning 500")
                 self.send_response(500)
                 self.end_headers()
                 self.wfile.write(b"Agent init failed. Please check configuration.")
                 return

            self.send_response(200)
            self.send_header('Content-type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            # Access-Control-Allow-Origin is good practice even for local
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            try:
                # Use stream_chat generator which yields structured events
                # debug_print("Starting event loop in api.py", file=sys.stderr)
                event_count = 0
                for event in active_agent.stream_chat(user_input):
                    event_count += 1
                    payload = json.dumps(event)
                    # debug_print(f"Event #{event_count}: {event.get('type', 'unknown')} - {str(event)[:100]}", file=sys.stderr)
                    try:
                        data_line = f"data: {payload}\n\n"
                        self.wfile.write(data_line.encode('utf-8'))
                        self.wfile.flush()
                        # debug_print(f"Sent event #{event_count} successfully", file=sys.stderr)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                        # 客户端断开连接（用户主动停止），静默处理，不打印错误
                        break
                
                # debug_print(f"Finished event loop, sent {event_count} events", file=sys.stderr)
                
                # Send [DONE] to signal end of stream to compatible clients
                try:
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    # 客户端断开连接（用户主动停止），静默处理
                    pass

                if session_id:
                    try:
                        session_store.save_llm_history(session_id, active_agent.history)
                    except Exception as e:
                        sys.stderr.write(f"[Session] Failed to save history: {e}\n")
                        sys.stderr.flush()
                    maybe_generate_title(session_id, user_input)
                    
                # debug_print("Sent [DONE] signal", file=sys.stderr)
                    
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                # 客户端断开连接（用户主动停止），静默处理，不打印错误
                pass
            except Exception as e:
                # 检查是否是连接相关的错误（用户主动停止）
                if isinstance(e, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)):
                    # 用户主动停止，静默处理
                    pass
                else:
                    # 真正的错误，才打印日志
                    import traceback
                    trace_str = traceback.format_exc()
                    sys.stderr.write(f"Agent execution error: {e}\n{trace_str}\n")
                    # Send error event if connection still open
                    error_payload = json.dumps({"type": "error", "content": f"Error: {str(e)}"})
                    try:
                        self.wfile.write(f"data: {error_payload}\n\n".encode('utf-8'))
                        self.wfile.flush()
                    except:
                        pass

        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid JSON")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            # 客户端断开连接（用户主动停止），静默处理，不打印错误
            pass
        except Exception as e:
            # 检查是否是连接相关的错误（用户主动停止）
            if isinstance(e, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)):
                # 用户主动停止，静默处理
                pass
            else:
                # 真正的错误，才打印日志
                import traceback
                sys.stderr.write(f"Server Error in /chat: {e}\n{traceback.format_exc()}\n")
                # If headers sent, we can't send 500.
                # But if we haven't sent headers yet:
                # We can't easily know state here without tracking.
                # Assuming if we crashed early, headers aren't sent.
                try:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(f"Internal Server Error: {e}".encode('utf-8'))
                except:
                    pass

def monitor_parent_process():
    """监控父进程，如果父进程退出则自动退出当前进程"""
    import psutil  # type: ignore
    try:
        parent = psutil.Process(os.getppid())
        parent_pid = parent.pid
        sys.stderr.write(f"[Monitor] Started monitoring parent process (PID: {parent_pid})\n")
        sys.stderr.flush()
        
        while True:
            time.sleep(2)  # 每2秒检查一次
            try:
                # 检查父进程是否还存在
                if not psutil.pid_exists(parent_pid):
                    sys.stderr.write(f"[Monitor] Parent process (PID: {parent_pid}) has exited. Terminating...\n")
                    sys.stderr.flush()
                    os._exit(0)  # 强制退出
            except Exception as e:
                sys.stderr.write(f"[Monitor] Error checking parent process: {e}\n")
                sys.stderr.flush()
                os._exit(0)
    except ImportError:
        sys.stderr.write("[Monitor] psutil not available, parent monitoring disabled\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[Monitor] Failed to start parent monitoring: {e}\n")
        sys.stderr.flush()

def run(port=5678):
    # 启动父进程监控线程
    monitor_thread = threading.Thread(target=monitor_parent_process, daemon=True)
    monitor_thread.start()
    
    # Use port 5678 to avoid conflicts
    server_address = ('127.0.0.1', port)
    
    # Create custom server with error handling and threading
    class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True  # Don't wait for thread termination
        allow_reuse_address = True
        request_queue_size = 10  # Increase queue size
        
        def handle_error(self, request, client_address):
            """Override to prevent server crash on handler errors."""
            sys.stderr.write(f"[Server] Error handling request from {client_address}\n")
            import traceback
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()
        
        def server_bind(self):
            """Override to log binding."""
            HTTPServer.server_bind(self)
            sys.stderr.write(f"[Server] Bound to {self.server_address}\n")
            sys.stderr.flush()
        
        def server_activate(self):
            """Override to log activation."""
            self.socket.listen(self.request_queue_size)
            sys.stderr.write(f"[Server] Listening on {self.server_address} (queue_size={self.request_queue_size})\n")
            sys.stderr.flush()
        
        def get_request(self):
            """Override to log incoming connections."""
            # sys.stderr.write(f"[Server] Calling accept() to get next connection...\n")
            sys.stderr.flush()
            try:
                sock, addr = self.socket.accept()
                # sys.stderr.write(f"[Server] Accepted connection from {addr}\n")
                sys.stderr.flush()
                return sock, addr
            except socket.timeout as e:
                sys.stderr.write(f"[Server] Socket accept() timeout: {e}\n")
                sys.stderr.flush()
                raise
            except Exception as e:
                sys.stderr.write(f"[Server] Error in accept(): {e}\n")
                import traceback
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
                raise
    
    sys.stderr.write(f"[Server] Creating server on {server_address}\n")
    sys.stderr.flush()
    
    httpd = ThreadedHTTPServer(server_address, RequestHandler)
    
    # No socket timeout for serve_forever() - it will block on accept() indefinitely
    httpd.socket.settimeout(None)
    sys.stderr.write("[Server] Socket timeout set to None (blocking mode)\n")
    sys.stderr.flush()
    
    print(f"Starting API server on port {port} (non-blocking mode)")
    sys.stdout.flush()
    
    # Init agent on start
    init_agent()
    start_news_monitor(enqueue_notification)
    
    sys.stderr.write("[Server] Ready to accept connections\n")
    sys.stderr.flush()
    
    sys.stderr.write("[Server] Starting serve_forever() - ready to handle requests\n")
    sys.stderr.flush()
    
    # Use serve_forever() for proper multi-request handling
    import signal
    
    def signal_handler(sig, frame):
        sys.stderr.write(f"\n[Server] Received signal {sig}, shutting down...\n")
        sys.stderr.flush()
        httpd.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Test socket is actually listening BEFORE serve_forever
    sys.stderr.write(f"[Server] Testing if socket is listening...\n")
    sys.stderr.flush()
    try:
        import socket as test_socket
        test_sock = test_socket.socket(test_socket.AF_INET, test_socket.SOCK_STREAM)
        test_sock.settimeout(2)
        test_sock.connect(('127.0.0.1', port))
        test_sock.send(b"GET /test HTTP/1.0\r\n\r\n")
        test_sock.close()
        sys.stderr.write(f"[Server] Socket test PASSED - server is listening!\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[Server] Socket test FAILED: {e}\n")
        sys.stderr.flush()
    
    # Run server in main thread
    try:
        sys.stderr.write(f"[Server] Main thread ID: {threading.get_ident()}\n")
        sys.stderr.write(f"[Server] About to call serve_forever()...\n")
        sys.stderr.flush()
        # serve_forever() with poll_interval (default 0.5s)
        httpd.serve_forever(poll_interval=0.5)
        sys.stderr.write(f"[Server] serve_forever() returned (should never happen)\n")
        sys.stderr.flush()
    except KeyboardInterrupt:
        sys.stderr.write("\n[Server] KeyboardInterrupt - shutting down...\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[Server] Fatal error: {e}\n")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
    finally:
        sys.stderr.write("[Server] Closing server...\n")
        sys.stderr.flush()
        stop_news_monitor()
        httpd.server_close()

if __name__ == '__main__':
    run()
