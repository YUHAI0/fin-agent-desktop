"""一次性触发股价提醒各场景，验证语义化文案（Toast/历史/邮件正文）。"""
import json
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fin-agent"
sys.path.insert(0, str(ROOT))

from fin_agent.config import Config  # noqa: E402
from fin_agent.scheduler import TaskScheduler  # noqa: E402
from fin_agent.alert_history import AlertHistoryStore  # noqa: E402
from fin_agent.datasources import get_provider  # noqa: E402
from fin_agent.tools.scheduler_tools import list_alerts  # noqa: E402

TS_CODE = "000001.SZ"


def main():
    Config.load()
    df = get_provider().get_realtime_price(TS_CODE)
    if df is None or df.empty:
        print("FAIL: 无法获取行情，跳过集成触发")
        return 1
    row = df.iloc[0].to_dict()
    price = float(row.get("price") or 0)
    stock_name = row.get("name") or TS_CODE
    if price <= 0:
        print("FAIL: 现价为 0，无法触发")
        return 1

    print(f"测试标的: {stock_name} ({TS_CODE}) 现价 {price:.2f}\n")

    scheduler = TaskScheduler()
    notifications = []

    def sink(payload):
        notifications.append(dict(payload))
        return True

    scheduler.set_notification_sink(sink)
    before_history = len(AlertHistoryStore().list_items(limit=500))

    scenarios = [
        ("绝对价-突破(>=)", {
            "operator": ">=",
            "threshold": round(price - 0.01, 4),
        }),
        ("绝对价-超过(>)", {
            "operator": ">",
            "threshold": round(price - 0.01, 4),
        }),
        ("绝对价-回落至(<=)", {
            "operator": "<=",
            "threshold": round(price + 0.01, 4),
        }),
        ("绝对价-跌破(<)", {
            "operator": "<",
            "threshold": round(price + 0.01, 4),
        }),
        ("百分比-上涨", {
            "operator": ">=",
            "threshold": round(price - 0.01, 4),
            "alert_mode": "pct",
            "base_price": round(price / 1.05, 4),
            "pct": 5,
            "direction": "up",
        }),
        ("百分比-下跌", {
            "operator": "<=",
            "threshold": round(price + 0.01, 4),
            "alert_mode": "pct",
            "base_price": round(price / 0.97, 4),
            "pct": 3,
            "direction": "down",
        }),
    ]

    passed = 0
    for label, meta in scenarios:
        notifications.clear()
        task = {
            "id": f"test_alert_{uuid.uuid4().hex[:8]}",
            "type": "price_alert",
            "ts_code": TS_CODE,
            "enabled": True,
            "email": None,
            **meta,
        }
        scheduler._check_price_alert(task)
        if not notifications:
            print(f"[FAIL] {label}: 未触发")
            continue
        n = notifications[0]
        title = n.get("title", "")
        body = n.get("body", "")
        ok_name = stock_name in title or stock_name in body
        ok_semantic = any(
            k in body
            for k in ("突破", "超过", "回落", "跌破", "上涨", "下跌")
        )
        status = "PASS" if ok_name and ok_semantic else "WARN"
        if status == "PASS":
            passed += 1
        print(f"[{status}] {label}")
        print(f"  title: {title}")
        print(f"  body:  {body}\n")
        time.sleep(0.2)

    after_history = AlertHistoryStore().list_items(limit=20)
    new_items = after_history[: max(0, len(after_history) - before_history)]
    if not new_items:
        new_items = after_history[:6]

    print("=== 最近触发历史 (message / condition_label) ===")
    for item in new_items[:6]:
        print(f"- {item.get('stock_name')} {item.get('ts_code')}")
        print(f"  condition: {item.get('condition_label')}")
        print(f"  message:   {item.get('message')}\n")

    print("=== list_alerts (Agent) ===")
    print("(当前无待触发任务属正常，因测试任务触发后已删除)\n")

    print(f"完成: {passed}/{len(scenarios)} 场景 Toast 文案检查通过")
    return 0 if passed == len(scenarios) else 1


if __name__ == "__main__":
    raise SystemExit(main())
