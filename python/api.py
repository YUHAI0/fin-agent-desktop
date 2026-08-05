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
except ImportError as e:
    print(f"Error importing fin_agent: {e}", file=sys.stderr)
    sys.exit(1)

# Initialize Agent
agent = None

# Notification queue for desktop notifications
notification_queue = []
notification_lock = threading.Lock()

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
    }


@route("GET", "/notifications/poll")
def handle_notifications_poll(req):
    with notification_lock:
        notifications = notification_queue.copy()
        notification_queue.clear()
    return {"notifications": notifications}


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
    return {"tasks": scheduler.list_tasks()}


@route("POST", "/notification")
def handle_notification(req):
    title = req.body.get('title', 'Fin-Agent 提醒')
    body = req.body.get('body', '')
    with notification_lock:
        notification_queue.append({
            "title": title,
            "body": body,
            "timestamp": time.time()
        })
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
        data.get('alert_trading_hours_only', True)
    )

    init_agent()
    return {"success": True, "path": Config.get_env_path()}


@route("POST", "/scheduler/tasks/remove")
def handle_scheduler_task_remove(req):
    task_id = req.body.get('task_id')
    if not task_id:
        raise ApiError(400, "missing task_id")
    scheduler = TaskScheduler()
    return {"success": True, "removed": scheduler.remove_task(task_id)}


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
            
            if not agent:
                 debug_print("Agent not initialized, trying to init...")
                 init_agent()
            
            if not agent:
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
                for event in agent.stream_chat(user_input):
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
        httpd.server_close()

if __name__ == '__main__':
    run()
