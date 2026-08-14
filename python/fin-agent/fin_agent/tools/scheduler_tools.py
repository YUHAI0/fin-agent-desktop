from fin_agent.scheduler import TaskScheduler
from fin_agent.config import Config
from fin_agent.alert_copy import format_condition_label

scheduler = TaskScheduler()

def add_price_alert(ts_code, operator, threshold, email=None):
    """
    Add a price monitoring alert.
    :param ts_code: Stock code (e.g., 000001.SZ)
    :param operator: Comparison operator ('>', '>=', '<', '<=')
    :param threshold: Price threshold
    :param email: (Optional) Email to receive notification.
    """
    try:
        task_id = scheduler.add_price_alert(ts_code, operator, threshold, email)
        email_note = (
            " Desktop notification will pop up when triggered."
            if not Config.is_email_configured()
            else " Desktop notification and email will be sent when triggered."
        )
        return (
            f"Success: Price alert added. Task ID: {task_id}. "
            f"You will be notified when {ts_code} price is {operator} {threshold}."
            f"{email_note}"
        )
    except Exception as e:
        return f"Error adding alert: {str(e)}"

def list_alerts():
    """
    List all active alerts.
    """
    tasks = scheduler.list_tasks()
    if not tasks:
        return "No active alerts."
    
    result = "Active Alerts:\n"
    for t in tasks:
        status = "Active" if t.get('enabled', True) else "Fired/Disabled"
        if t['type'] == 'price_alert':
            label = format_condition_label(t)
            result += f"- [{status}] {t.get('ts_code')} · {label} (ID: {t['id']})\n"
        else:
            result += f"- [{status}] Unknown Task Type (ID: {t['id']})\n"
    return result

def remove_alert(task_id):
    """
    Remove an alert by ID.
    """
    if scheduler.remove_task(task_id):
        return f"Success: Alert {task_id} removed."
    else:
        return f"Error: Alert {task_id} not found."

def update_alert(task_id, ts_code=None, operator=None, threshold=None):
    """
    Update an existing alert.
    """
    if scheduler.update_price_alert(task_id, ts_code, operator, threshold):
        return f"Success: Alert {task_id} updated and re-enabled."
    else:
        return f"Error: Alert {task_id} not found."

SCHEDULER_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "add_price_alert",
            "description": "Add a scheduled task to monitor stock price. Triggers a desktop notification (and email if configured) when condition is met. Email is optional.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ts_code": {
                        "type": "string",
                        "description": "The stock code (e.g., '000001.SZ')."
                    },
                    "operator": {
                        "type": "string",
                        "enum": [">", ">=", "<", "<="],
                        "description": "Comparison operator."
                    },
                    "threshold": {
                        "type": "number",
                        "description": "The ABSOLUTE PRICE threshold (e.g., 20.5). DO NOT use a percentage or ratio (like 1.01). If the user asks for a percentage rise/fall, you MUST fetch the current price first, calculate the target absolute price, and use that as the threshold."
                    },
                    "email": {
                        "type": "string",
                        "description": "Optional email address. If not provided, uses the default configured sender."
                    }
                },
                "required": ["ts_code", "operator", "threshold"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_alerts",
            "description": "List all configured price alerts.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "remove_alert",
            "description": "Remove a configured alert.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The ID of the task to remove."
                    }
                },
                "required": ["task_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_alert",
            "description": "Update an existing price alert.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The ID of the task to update."
                    },
                    "ts_code": {
                        "type": "string",
                        "description": "New stock code (optional)."
                    },
                    "operator": {
                        "type": "string",
                        "enum": [">", ">=", "<", "<="],
                        "description": "New comparison operator (optional)."
                    },
                    "threshold": {
                        "type": "number",
                        "description": "New price threshold (optional)."
                    }
                },
                "required": ["task_id"]
            }
        }
    }
]

