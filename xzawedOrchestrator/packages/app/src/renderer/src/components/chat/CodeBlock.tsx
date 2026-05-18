import React, { useState, useEffect } from 'react'
import { getHighlighter, detectLang } from '../../lib/markdown.js'

interface Props {
  code: string
  filename?: string
  lang?: string
  streaming?: boolean
}

export function CodeBlock({ code, filename, lang, streaming = false }: Props): React.JSX.Element {
  const [html, setHtml] = useState('')
  const [copied, setCopied] = useState(false)
  const language = lang ?? detectLang(filename)

  useEffect(() => {
    let cancelled = false
    getHighlighter().then((hl) => {
      if (cancelled) return
      const highlighted = hl.codeToHtml(code, { lang: language, theme: 'dark-plus' })
      setHtml(highlighted)
    }).catch(() => setHtml(`<pre><code>${code}</code></pre>`))
    return () => { cancelled = true }
  }, [code, language])

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mt-2 overflow-hidden rounded border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[9px] text-fg-ghost">{filename ?? language}</span>
        <button
          onClick={handleCopy}
          className="text-[9px] text-accent hover:text-fg transition-colors duration-150"
        >
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <div className="relative overflow-x-auto">
        {html ? (
          <div
            className="px-3 py-2 text-[10px] [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
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
