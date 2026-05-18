import React, { useState, useEffect, useRef, type ReactNode } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { getHighlighter, detectLang } from '../../lib/markdown.js'

interface Props {
  code: string
  filename?: string
  lang?: string
  streaming?: boolean
}

export function CodeBlock({ code, filename, lang, streaming = false }: Props): React.JSX.Element {
  const [node, setNode] = useState<ReactNode>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const language = lang ?? detectLang(filename)

  useEffect(() => {
    let cancelled = false
    getHighlighter()
      .then((hl) => {
        if (cancelled) return
        const hast = hl.codeToHast(code, { lang: language, theme: 'dark-plus' })
        setNode(toJsxRuntime(hast, { jsx, jsxs, Fragment }))
      })
      .catch(() => {
        if (!cancelled) {
          setNode(
            <pre className="px-3 py-2 text-[10px] text-fg-muted font-mono">
              <code>{code}</code>
            </pre>
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
    }
  }, [])

  function handleCopy(): void {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard denied — no-op */ })
  }

  return (
    <div className="mt-2 overflow-hidden rounded border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[9px] text-fg-ghost">{filename ?? language}</span>
        <button
          data-testid="code-copy-button"
          onClick={handleCopy}
          className="text-[9px] text-accent hover:text-fg transition-colors duration-150"
        >
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <div className="relative overflow-x-auto">
        {node ? (
          <div className="px-3 py-2 text-[10px] [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0">
            {node}
          </div>
        ) : (
          <pre className="px-3 py-2 text-[10px] text-fg-muted font-mono">{code}</pre>
        )}
        {streaming && (
          <span className="absolute bottom-2 right-3 inline-block h-3 w-0.5 bg-fg animate-blink" />
        )}
      </div>
    </div>
  )
}
