import type { Message } from '../contexts/ChatContext'

/** 须与 extractReplyQuickOptions 与 Python system prompt 中字符串一致 */
const FIN_AGENT_CHOICES_KEY = 'FIN_AGENT_CHOICES_JSON'

const WELCOME_CHOICES = [
  { label: '茅台现价', send: '贵州茅台现在股价多少？' },
  { label: 'MACD 回测', send: '用 MACD 策略回测 600519.SH 近一年的表现' },
  { label: '我的持仓', send: '我当前持仓有哪些？盈亏情况怎样？' },
  { label: '沪深300', send: '沪深300指数最近一个月走势和涨跌幅' },
  { label: '低估值蓝筹', send: '帮我筛一些估值偏低的蓝筹股票，简要说明理由' },
  { label: '今日宏观', send: '今天需要关注的宏观与政策要点有哪些？' }
] as const

/**
 * 首次进入或清空历史后展示的本地问候（不调用 LLM），末尾带 FIN_AGENT_CHOICES_JSON 供快捷按钮解析。
 */
export function createWelcomeAgentMessage(): Message {
  const choicesJson = JSON.stringify([...WELCOME_CHOICES])
  const machineLine = `${FIN_AGENT_CHOICES_KEY} ${choicesJson}`

  const md = `你好，我是 **Fin-Agent**，你的本地金融助手。

我可以帮你做这些事：

- **行情与 K 线**：A 股 / 港股 / 美股 / ETF / 期货等报价与日线走势  
- **财务与估值**：利润表、PE/PB、市值等基本面数据  
- **技术与筛选**：技术指标、形态、条件选股、长尾标的发现  
- **组合与提醒**：持仓查询、价格/涨跌幅邮件提醒  
- **策略回测**：均线、MACD、RSI 等简单策略的历史表现与收益曲线  

你可以**直接点下面快捷语句**，或在底部输入框用自然语言提问。首次使用请先完成 **设置** 里的 Tushare Token 与模型配置。

${machineLine}`

  return {
    role: 'assistant',
    content: md,
    blocks: [{ type: 'text', content: md }]
  }
}
