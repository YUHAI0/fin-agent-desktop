import React from 'react'

interface SubPageShellProps {
  children: React.ReactNode
  className?: string
}

/** 设置 / 投资组合 / 关于等全屏子页容器，页头即系统标题栏 */
export const SubPageShell: React.FC<SubPageShellProps> = ({ children, className = '' }) => {
  return <div className={`fa-page ${className}`.trim()}>{children}</div>
}

export default SubPageShell
