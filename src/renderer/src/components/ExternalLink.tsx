import React from 'react'

function isHttpHref(href?: string | null): boolean {
  return Boolean(href && /^https?:\/\//i.test(href.trim()))
}

export function openExternalUrl(url?: string | null): void {
  const target = (url || '').trim()
  if (!isHttpHref(target)) return
  void window.api.openExternal(target)
}

/** 捕获阶段拦截 http(s) 锚点，避免应用内跳转 */
export function handleDocumentLinkClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement | null)?.closest?.('a')
  if (!el) return
  const href = el.getAttribute('href')
  if (!isHttpHref(href)) return
  e.preventDefault()
  e.stopPropagation()
  openExternalUrl(href)
}

export function MarkdownExternalLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  return (
    <a
      {...props}
      href={href}
      rel="noreferrer"
      onClick={(e) => {
        if (!isHttpHref(href)) return
        e.preventDefault()
        e.stopPropagation()
        openExternalUrl(href)
      }}
    >
      {children}
    </a>
  )
}
