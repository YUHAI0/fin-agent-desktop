import json
import inspect
import os
from datetime import datetime
from types import SimpleNamespace
from colorama import Fore, Style
from fin_agent.config import Config
from fin_agent.llm.factory import LLMFactory
from fin_agent.tools.tushare_tools import TOOLS_SCHEMA, execute_tool_call
from fin_agent.tools.profile_tools import get_profile_manager
from fin_agent.utils import FinMarkdown
from rich.console import Console
from rich.live import Live

_LOCAL_LLM_HINT = (
    "当前使用的是本地模型，可能不支持或未正确响应工具调用。"
    "建议更换为 Qwen2.5 等支持 function calling 的模型，或在设置中改用 DeepSeek 等云端 API。"
)


def _maybe_append_local_hint(msg: str) -> str:
    if Config.LLM_PROVIDER != "local":
        return msg
    if _LOCAL_LLM_HINT in msg:
        return msg
    return f"{msg}\n\n{_LOCAL_LLM_HINT}"


def _format_llm_error(exc: Exception) -> str:
    text = str(exc)
    lowered = text.casefold()
    if "not found" in lowered and "model" in lowered:
        model = Config.OPENAI_MODEL or "未知"
        return (
            f"本地模型「{model}」不可用（Ollama 未安装该模型）。\n"
            "请到设置页点击「刷新模型列表」，从下拉选择已安装的模型；\n"
            f"或在终端运行：ollama pull {model}"
        )
    return f"Error: {text}"


class FinAgent:
    def __init__(self):
        self.llm = LLMFactory.create_llm()
        self.history = []
        self._init_history()

    # 无 Tushare Token 时不可用的工具清单，用于提示模型不要反复尝试
    TUSHARE_ONLY_TOOLS = (
        "screen_stocks, get_long_tail_stocks, get_moneyflow, get_limit_list, get_top_list, "
        "get_forecast, get_concept_detail, get_hsgt_top10, get_hk_stock_basic, get_hk_daily_price, "
        "get_hk_realtime_price, get_us_stock_basic, get_us_daily_price, get_us_realtime_price, "
        "get_etf_basic, get_etf_daily_price, get_cb_basic, get_cb_daily_price, "
        "get_futures_basic, get_futures_daily_price, get_macro_gdp, get_macro_cpi, get_macro_m2, "
        "get_macro_interest_rate, get_global_index_comparison"
    )

    def _get_datasource_note(self):
        source = Config.DATA_SOURCE or "akshare"
        if Config.TUSHARE_TOKEN:
            return (
                f"### 数据源 ###\n"
                f"当前行情数据源：{source}，所列工具均可使用。\n\n"
            )
        return (
            f"### 数据源 ###\n"
            f"当前行情数据源：{source}。用户未配置 Tushare Token。\n"
            f"以下工具仅 Tushare 可用（TUSHARE_ONLY_TOOLS）。无 Token 时调用只会返回设置提示："
            f"**禁止调用，禁止因失败而重试，禁止换清单内其他工具再试。**\n"
            f"不可用工具：{self.TUSHARE_ONLY_TOOLS}\n"
            f"若用户询问选股筛选、资金流、涨跌停/龙虎榜、业绩预告、概念成分、沪深港通、"
            f"港美股、ETF、可转债、期货、宏观或全球指数对比：只引导一次打开设置页填写 Tushare Token，"
            f"不要循环调用工具，也不要用其他工具凑数假装已取得这些数据。\n"
            f"A 股现价、日线、估值、财报、指数仍可用当前数据源。\n\n"
        )

    def _get_system_content(self):
        # Get user profile summary
        user_profile_summary = get_profile_manager().get_profile_summary()
        datasource_note = self._get_datasource_note()

        return (
            "你是 Fin-Agent 金融助手，通过实时行情工具帮用户分析股票、查价格、做回测与提醒。\n\n"
            "### 语言（最高优先级，必须遵守） ###\n"
            "本应用面向中国大陆用户，**所有**展示给用户的文字必须是**简体中文**。\n"
            "包括：开场白、工具调用前的说明、分析正文、表格表头、错误说明、建议与 FIN_AGENT_CHOICES_JSON 的 label/send。\n"
            "禁止中英混写（错误示例：「I'll run…比亚迪…」「Couldn't查询」）。\n"
            "禁止整句或整段英文回复；即使用户消息或历史对话里出现过英文，从现在起也必须只用简体中文。\n"
            "工具 API 名称保持英文（如 run_backtest）；向用户描述时用中文（如「策略回测」，不要写 run_backtest）。\n"
            "工具返回英文错误时，须完整改写为中文再回复。\n"
            "**调用工具前**：不要输出英文铺垫（错误示例：「I'll run the RSI strategy backtest on…」）。"
            "优先**直接调用工具不输出文字**；若需提示，仅允许一句简短中文（如「正在对比亚迪执行 RSI 回测…」）。\n"
            "检查时间（get_current_time）须静默调用，不要告诉用户你在确认时间。\n\n"
            f"{datasource_note}"
            "### 关键流程 ###\n"
            "1. **先确认时间**：涉及行情、今天、最新等，必须先调用 get_current_time（静默，不向用户说明）。\n"
            "2. **必须用工具**：行情数据只能来自工具，不要用内部知识编造。\n"
            "3. **少废话多执行**：能直接调工具就不要先写长段说明；结果出来后再用中文解读。\n\n"
            "### 工具选用 ###\n"
            "查现价用 get_realtime_price；趋势/历史用 get_daily_price（复权：qfq/前复权、hfq/后复权，省略为不复权）。\n"
            "估值 PE/PB/市值用 get_daily_basic；财报用 get_income_statement；指数用 get_index_daily。\n"
            "港股：get_hk_stock_basic / get_hk_daily_price / get_hk_realtime_price；"
            "美股：get_us_stock_basic / get_us_daily_price / get_us_realtime_price。\n"
            "ETF：get_etf_basic、get_etf_daily_price；可转债：get_cb_basic、get_cb_daily_price；"
            "期货：get_futures_basic、get_futures_daily_price。\n"
            "宏观：get_macro_gdp、get_macro_cpi、get_macro_m2、get_macro_interest_rate；全球指数对比：get_global_index_comparison。\n"
            "技术指标：get_technical_indicators；形态：get_technical_patterns；"
            "资金流/涨跌停/概念：对应工具；策略回测：run_backtest。\n"
            "持仓查询（我的持仓等）：get_portfolio_status；增删持仓：add_portfolio_position / remove_portfolio_position。\n"
            "新闻：查本地已推送 → query_notified_news；按需查全量/个股/板块 → query_news；"
            "订阅用 create_news_subscription（持仓订阅不要传 symbols）。\n"
            "管理订阅：list/update/pause/enable/delete_news_subscription；仅用户要求立即刷新时用 refresh_news。\n"
            "新闻通过桌面通知推送；不要声称后台 LLM 会生成新闻摘要。\n"
            "创建/更新/暂停/启用/删除/刷新操作，须等工具返回后再汇报结果。\n"
            "百分比价格提醒须先取现价算出绝对价再设提醒。\n"
            "不要向用户索要 API Key；改 Tushare/LLM/邮箱等设置请引导打开应用设置页。\n"
            "分析时明确写出数据日期；说明涨跌与趋势；信息足够时直接回答。\n\n"
            "### 输出格式 ###\n"
            "3 项及以上列表必须用 Markdown 表格或有序/无序列表，不要用大段纯文字。\n"
            "不要用 ASCII 树形图或代码块画价位/均线，用表格（列如：价位、价格、作用）。\n\n"
            "### 分析结构 ###\n"
            "实质性分析（行情解读、持仓诊断、策略讨论等）须按以下 Markdown 结构组织：\n"
            "## 结论\n"
            "### 依据\n"
            "### 风险\n"
            "### 下一步\n"
            "禁止只堆表格或指标而无明确结论。\n\n"
            "### 经验分层 ###\n"
            "须读取下方用户画像中的 experience_level（新手/老手/未知），调整分析深度与术语：\n"
            "- beginner（新手）：解释专业术语，用简版说明，少堆砌指标，侧重「这意味着什么」。\n"
            "- experienced（老手）：可给完整指标表与数据，少客套与基础科普。\n"
            "- Unknown：适中深度，必要时简短解释术语。\n\n"
            "### 快捷回复 FIN_AGENT_CHOICES_JSON（高优先级） ###\n"
            "每次实质性回复末尾追加一行：FIN_AGENT_CHOICES_JSON + 紧凑 JSON 数组（2-8 条）。\n"
            "每条含 label 与 send，且二者相同，为简短中文行动意图（如「设置价格提醒」「组合诊断」「深入 MACD 分析」），"
            "不要预填代码或参数。\n"
            "须偏行动导向，避免「再查一次现价」「再看看行情」等无价值选项。\n"
            "示例：FIN_AGENT_CHOICES_JSON [{\"label\":\"MACD回测\",\"send\":\"MACD回测\"},{\"label\":\"设置价格提醒\",\"send\":\"设置价格提醒\"}]\n"
            "简单确认（如「好的」）可省略。功能总览请求须全面回答并附 6-8 条示例意图。\n\n"
            "### 工具失败 ###\n"
            "工具调用失败时，须用中文向用户说明原因并给出替代方案，例如：\n"
            "- 未配置 Tushare Token → 只引导一次打开设置页填写 Token；"
            "禁止再次调用 TUSHARE_ONLY_TOOLS 清单中的任何工具；\n"
            "- akshare 或网络失败 → 建议稍后重试或换用其他可用工具；\n"
            "不要只输出英文错误原文或反复重试同一失败工具。\n\n"
            "### 免责声明 ###\n"
            "分析类较长回复末尾须单独一行：「以上内容仅供参考，不构成投资建议。」\n\n"
            "### 用户画像与记忆 ###\n"
            "可用 update_user_profile 保存用户偏好。当前画像：\n"
            f"{user_profile_summary}\n\n"
            "结合画像给建议；用户未给条件时参考画像（如「根据您偏好低风险…」）。"
        )

    def _init_history(self):
        """Initialize history with system prompt."""
        self.history = [
            {"role": "system", "content": self._get_system_content()}
        ]

    def _to_dict(self, message):
        """Helper to convert message object to dictionary."""
        if isinstance(message, dict):
            return message
        if hasattr(message, 'model_dump'):
            return message.model_dump()
        if hasattr(message, 'to_dict'):
            return message.to_dict()
        # Fallback for SimpleNamespace or other objects
        return {
            "role": getattr(message, "role", "assistant"),
            "content": getattr(message, "content", ""),
            "tool_calls": getattr(message, "tool_calls", None)
        }

    # CLI 使用的固定会话 id，与多标签会话共用同一套存储
    CLI_SESSION_ID = "cli-last-session"

    def save_session(self, filename="last_session.json"):
        """保存当前上下文。保留 filename 参数以兼容 CLI 调用。"""
        from fin_agent import session_store
        session_store.save_llm_history(self.CLI_SESSION_ID, self.history)
        return f"Session saved to {session_store.sessions_dir()}"

    def load_session(self, filename="last_session.json"):
        """载入 CLI 会话上下文。保留 filename 参数以兼容 CLI 调用。"""
        from fin_agent import session_store
        try:
            body = session_store.get_session(self.CLI_SESSION_ID)
        except KeyError:
            return "No saved session found."
        history = body.get("llm_history") or []
        if not history:
            return "No saved session found."
        self.history = history
        return "Session loaded."

    def clear_history(self):
        """Clear conversation history (keep system prompt)."""
        self._init_history()

    def stream_chat(self, user_input):
        """
        Generator function that yields events for the chat interaction.
        Yields dicts with 'type' and 'content'/'data'.
        Types: 'content', 'thinking', 'tool_call', 'tool_result', 'error', 'log', 'answer'
        """
        import sys
        from fin_agent.utils import debug_print
        debug_print(f"Starting stream_chat with input: {user_input[:50]}...", file=sys.stderr)
        
        # Check if LLM is valid
        if not self.llm:
             yield {"type": "error", "content": "LLM not initialized. Please check configuration."}
             return
        
        # Update system prompt to ensure latest profile is used
        if self.history and self.history[0].get('role') == 'system':
             self.history[0]['content'] = self._get_system_content()
        else:
             self.history.insert(0, {"role": "system", "content": self._get_system_content()})

        # Append user input
        self.history.append({"role": "user", "content": user_input})

        step = 0
        try:
            while True:
                step += 1
                debug_print(f"Step {step}", file=sys.stderr)
                
                try:
                    # Determine stream mode from Config - Force True for stream_chat
                    stream_mode = True 
                    
                    debug_print("Calling LLM chat...", file=sys.stderr)
                    response = self.llm.chat(self.history, tools=TOOLS_SCHEMA, tool_choice="auto", stream=stream_mode)
                    debug_print(f"LLM chat returned {type(response)}", file=sys.stderr)
                    
                    message = None
                    
                    if stream_mode and inspect.isgenerator(response):
                        full_content = ""
                        stream_interrupted = False
                        
                        # Buffer for handling <think> tags
                        buffer = ""
                        thinking_state = False
                        
                        try:
                            debug_print("Starting response iteration", file=sys.stderr)
                            for chunk in response:
                                if chunk['type'] == 'content':
                                    content = chunk['content']
                                    full_content += content 
                                    buffer += content
                                    
                                    while True:
                                        if not thinking_state:
                                            # Look for <think>
                                            tag = "<think>"
                                            if tag in buffer:
                                                pre, buffer = buffer.split(tag, 1)
                                                if pre:
                                                    yield {"type": "content", "content": pre}
                                                yield {"type": "log", "content": "Thinking..."}
                                                thinking_state = True
                                                continue # Re-evaluate buffer in thinking state
                                            
                                            # Smart Flush: Yield anything that can't be part of <think>
                                            # If no '<', yield all
                                            if "<" not in buffer:
                                                if buffer:
                                                    yield {"type": "content", "content": buffer}
                                                    buffer = ""
                                                break
                                            
                                            # Has '<'. Find first '<'
                                            idx = buffer.find("<")
                                            # Yield everything before '<'
                                            if idx > 0:
                                                yield {"type": "content", "content": buffer[:idx]}
                                                buffer = buffer[idx:]
                                            
                                            # Now buffer starts with '<'
                                            # Check if it matches partial tag
                                            # buffer is like "<...", len >= 1
                                            
                                            # If buffer is shorter than tag, checking partial match
                                            # Optimization: just check if it IS a prefix
                                            if tag.startswith(buffer):
                                                # It is a prefix, we must wait for more data
                                                break
                                            
                                            # It's NOT a prefix of <think> (e.g. "<div>" or "< 5")
                                            # But wait, what if buffer is longer than tag?
                                            # We already checked `if tag in buffer`.
                                            # So if len(buffer) >= len(tag) and tag not in buffer (at start),
                                            # then it's not our tag.
                                            
                                            if len(buffer) >= len(tag):
                                                # We know it starts with < but is not <think>
                                                # Yield the < and continue
                                                yield {"type": "content", "content": "<"}
                                                buffer = buffer[1:]
                                                continue
                                            
                                            # If len(buffer) < len(tag), we checked startswith above.
                                            # If it didn't match startswith, it's not our tag.
                                            if not tag.startswith(buffer):
                                                 yield {"type": "content", "content": "<"}
                                                 buffer = buffer[1:]
                                                 continue
                                            
                                            # Should be caught by startswith check, but safe break
                                            break

                                        else:
                                            # Thinking State - Look for </think>
                                            tag = "</think>"
                                            if tag in buffer:
                                                pre, buffer = buffer.split(tag, 1)
                                                if pre: 
                                                    yield {"type": "thinking", "content": pre}
                                                thinking_state = False
                                                # yield {"type": "log", "content": "Thinking ended."}
                                                if buffer.startswith("\n"): buffer = buffer[1:]
                                                elif buffer.startswith("\r\n"): buffer = buffer[2:]
                                                continue # Re-evaluate buffer in content state

                                            # Smart Flush for Thinking
                                            if "<" not in buffer:
                                                if buffer:
                                                    yield {"type": "thinking", "content": buffer}
                                                    buffer = ""
                                                break
                                            
                                            idx = buffer.find("<")
                                            if idx > 0:
                                                yield {"type": "thinking", "content": buffer[:idx]}
                                                buffer = buffer[idx:]
                                            
                                            # buffer starts with <
                                            if tag.startswith(buffer):
                                                break
                                            
                                            if len(buffer) >= len(tag):
                                                yield {"type": "thinking", "content": "<"}
                                                buffer = buffer[1:]
                                                continue
                                                
                                            if not tag.startswith(buffer):
                                                 yield {"type": "thinking", "content": "<"}
                                                 buffer = buffer[1:]
                                                 continue
                                            
                                            break
                                    
                                elif chunk['type'] == 'tool_call_chunk':
                                    # If we receive a tool call chunk, it means content/thinking stream is paused or done for now.
                                    # Flush buffer immediately to show any pending thinking/content
                                    if buffer:
                                        if thinking_state:
                                            yield {"type": "thinking", "content": buffer}
                                        else:
                                            yield {"type": "content", "content": buffer}
                                        buffer = ""

                                    # Yield the tool call chunk to frontend for real-time update
                                    yield chunk

                                elif chunk['type'] == 'response':
                                    debug_print("Received final response object", file=sys.stderr)
                                    message = chunk['response']
                            
                            debug_print("Response iteration finished", file=sys.stderr)
                            
                            # Flush remaining buffer
                            if buffer:
                                if thinking_state:
                                    yield {"type": "thinking", "content": buffer}
                                else:
                                    yield {"type": "content", "content": buffer}
                            
                        except KeyboardInterrupt:
                            # print("DEBUG: KeyboardInterrupt during iteration", file=sys.stderr)
                            stream_interrupted = True
                            yield {"type": "error", "content": "Interrupted by user"}
                        
                        if stream_interrupted:
                             # Save partial content if any
                             if full_content:
                                 message = SimpleNamespace(role="assistant", content=full_content, tool_calls=None)
                                 self.history.append(message)
                             return

                    else:
                        # Handle Normal Response (Non-stream fallback)
                        # print("DEBUG: Handling non-stream response", file=sys.stderr)
                        message = response
                        if message.content:
                            yield {"type": "content", "content": message.content}

                except Exception as e:
                    import traceback
                    err_msg = _format_llm_error(e)
                    if Config.LLM_PROVIDER == "local" and "未安装该模型" not in err_msg:
                        err_msg = _maybe_append_local_hint(err_msg)
                    # print(f"DEBUG: Exception in stream_chat: {traceback.format_exc()}", file=sys.stderr)
                    yield {"type": "error", "content": err_msg}
                    return

                if not message:
                    debug_print("Message is None after loop!", file=sys.stderr)
                    return

                # If no tool calls, this is the final answer
                if not message.tool_calls:
                    answer = message.content if message.content else ""
                    # debug_print(f"No tool calls, finishing. Answer: '{answer[:100] if answer else '(empty)'}'", file=sys.stderr)
                    self.history.append(self._to_dict(message)) # Keep history
                    # Always yield answer event, even if empty, so frontend knows we're done
                    yield {"type": "answer", "content": answer}
                    return

                # Handle tool calls
                # print(f"DEBUG: Processing {len(message.tool_calls)} tool calls", file=sys.stderr)
                self.history.append(self._to_dict(message)) # Add assistant's message with tool_calls to history

                for tool_index, tool_call in enumerate(message.tool_calls):
                    function_name = tool_call.function.name
                    arguments = tool_call.function.arguments
                    call_id = tool_call.id
                    # CLI run() depends on this; streaming already emitted tool_call_chunk for the GUI.
                    yield {"type": "tool_call", "tool_name": function_name, "args": arguments}
                    
                    # Execute tool
                    try:
                        tool_result = execute_tool_call(function_name, arguments)
                    except Exception as e:
                        tool_result = _maybe_append_local_hint(f"Error executing tool: {e}")

                    yield {
                        "type": "tool_result",
                        "tool_name": function_name,
                        "tool_call_id": call_id,
                        "tool_index": tool_index,
                        "result": str(tool_result),
                    }

                    # Append tool result to history
                    self.history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": str(tool_result)
                    })

        except KeyboardInterrupt:
            yield {"type": "error", "content": "Interrupted by user"}
            return

    def run(self, user_input, callback=None):
        """
        Run the agent with user input.
        Kept for backward compatibility and CLI usage.
        """
        # We'll use stream_chat internally to avoid code duplication, 
        # but we need to reconstruct the rich/Live display logic.
        
        # NOTE: This is a slightly simplified version of the original run to reuse stream_chat.
        # If strict exact behavior of original CLI is needed, we might need to be more careful.
        # But for now, let's try to adapt the CLI to consume the generator.

        # However, the original run method had complex Live Markdown update logic 
        # that might be hard to perfectly replicate from the event stream without some work.
        # To be SAFE and not break CLI, I will leave the original run method mostly AS IS,
        # but I will copy the logic to stream_chat. 
        # (Wait, I just overwrote the whole file content in the tool call above?)
        # YES. I need to put the original `run` method back or reimplement it.
        
        # Re-implementing run using stream_chat to ensure consistency:
        
        print(f"{Fore.CYAN}Agent: {Style.RESET_ALL}")
        
        live_md = None
        md_buffer = ""

        def stop_md():
            nonlocal live_md, md_buffer
            if live_md:
                live_md.stop()
                live_md = None
                md_buffer = ""

        def update_md(text):
            nonlocal live_md, md_buffer
            md_buffer += text
            if live_md is None:
                live_md = Live(FinMarkdown(md_buffer), auto_refresh=True, refresh_per_second=4, vertical_overflow="visible")
                live_md.start()
            else:
                live_md.update(FinMarkdown(md_buffer))

        generator = self.stream_chat(user_input)
        
        final_answer = ""

        # Filter out the FIN_AGENT_CHOICES_JSON marker line intended only for the
        # desktop client's quick-reply parser. CLI users should not see this.
        choices_marker = "FIN_AGENT_CHOICES_JSON"
        content_filter_buf = ""
        choices_suppressed = False

        def filter_content_chunk(text):
            nonlocal content_filter_buf, choices_suppressed
            if choices_suppressed:
                return ""
            content_filter_buf += text
            idx = content_filter_buf.find(choices_marker)
            if idx != -1:
                out = content_filter_buf[:idx].rstrip()
                content_filter_buf = ""
                choices_suppressed = True
                return out
            # Hold back a tail that could still become the marker when more chunks arrive.
            max_tail = min(len(choices_marker) - 1, len(content_filter_buf))
            hold = 0
            for length in range(max_tail, 0, -1):
                if choices_marker.startswith(content_filter_buf[-length:]):
                    hold = length
                    break
            if hold == 0:
                out = content_filter_buf
                content_filter_buf = ""
                return out
            out = content_filter_buf[:-hold]
            content_filter_buf = content_filter_buf[-hold:]
            return out

        def flush_content_filter():
            nonlocal content_filter_buf
            if choices_suppressed:
                content_filter_buf = ""
                return ""
            out = content_filter_buf
            content_filter_buf = ""
            return out

        # Thinking is printed to the raw terminal; reset styles before normal content / tools
        # so output order does not look glued or color-bleed into the next block.
        thinking_pending_reset = False

        try:
            for event in generator:
                event_type = event['type']
                
                if event_type == 'content':
                    if thinking_pending_reset:
                        print(Style.RESET_ALL, end="", flush=True)
                        thinking_pending_reset = False
                    content = event['content']
                    visible = filter_content_chunk(content)
                    if visible:
                        update_md(visible)
                    if callback: callback('content', content)
                    
                elif event_type == 'thinking':
                    content = event['content']
                    tail = flush_content_filter()
                    if tail:
                        update_md(tail)
                    stop_md()
                    thinking_pending_reset = True
                    print(f"{Style.DIM}{Fore.YELLOW}{content}", end="", flush=True)
                    # We might need to handle resetting color after thinking block ends
                    # The generator stream separates thinking chunks. 
                    # We need to know when thinking ENDS to reset color?
                    # The generator doesn't explicitly say "thinking_end".
                    # But if we receive 'content' after 'thinking', we should reset.
                    pass 
                    
                elif event_type == 'tool_call':
                    tail = flush_content_filter()
                    if tail:
                        update_md(tail)
                    stop_md()
                    print(Style.RESET_ALL, end="", flush=True)
                    thinking_pending_reset = False
                    
                    name = event['tool_name']
                    args = event['args']
                    print(f"\n{Fore.CYAN}Calling Tool: {name}{Style.RESET_ALL}")
                    if callback: callback('tool_call', {"name": name, "args": args})

                elif event_type == 'tool_result':
                    if thinking_pending_reset:
                        print(Style.RESET_ALL, end="", flush=True)
                        thinking_pending_reset = False
                    result = event['result']
                    compact = " ".join(str(result).split())
                    display_result = compact[:120] + "..." if len(compact) > 120 else compact
                    print(f"\n{Fore.BLUE}Tool Result: {display_result}{Style.RESET_ALL}")
                    if callback: callback('tool_result', {"name": event['tool_name'], "result": result})

                elif event_type == 'error':
                    stop_md()
                    print(f"\n{Fore.RED}Error: {event['content']}{Style.RESET_ALL}")
                    if callback: callback('error', event['content'])
                    return event['content']

                elif event_type == 'answer':
                    tail = flush_content_filter()
                    if tail:
                        update_md(tail)
                    answer_text = event['content']
                    if choices_marker in answer_text:
                        answer_text = answer_text.split(choices_marker, 1)[0].rstrip()
                    final_answer = answer_text
            
            stop_md()
            print(Style.RESET_ALL) # Ensure reset at end
            return final_answer

        except KeyboardInterrupt:
            stop_md()
            print(f"\n{Fore.YELLOW}[Interrupted by user]{Style.RESET_ALL}")
            return ""
