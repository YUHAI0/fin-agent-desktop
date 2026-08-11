/** 图表主题色：从 CSS 变量读取，随昼夜模式切换。 */
export function readChartTheme(el: HTMLElement = document.documentElement) {
  const s = getComputedStyle(el)
  const get = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    background: get('--fa-chart-bg', '#161616'),
    text: get('--fa-chart-text', '#8e8e8e'),
    grid: get('--fa-chart-grid', 'rgba(255, 255, 255, 0.05)'),
    border: get('--fa-chart-border', 'rgba(255, 255, 255, 0.06)'),
    areaLine: get('--fa-accent', '#f59e0b'),
    areaTop: get('--fa-chart-area-top', 'rgba(245, 158, 11, 0.18)'),
    areaBottom: get('--fa-chart-area-bottom', 'rgba(245, 158, 11, 0)'),
    candleUp: get('--fa-candle-up', '#ef4444'),
    candleDown: get('--fa-candle-down', '#22c55e')
  }
}
