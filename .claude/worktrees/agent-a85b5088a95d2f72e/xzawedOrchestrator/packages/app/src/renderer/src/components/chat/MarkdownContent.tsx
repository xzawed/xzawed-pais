import React, { createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock.js'

interface Props {
  content: string
  streaming?: boolean
}

type CodeProps = React.ComponentPropsWithRef<'code'> & { node?: unknown }

const StreamingContext = createContext(false)

function MarkdownCode({ node: _node, className, children, ref: _ref, ...props }: CodeProps): React.JSX.Element {
  const streaming = useContext(StreamingContext)
  const match = /language-(\w+)/.exec(className ?? '')
  if (!match) {
    return (
      <code className="rounded bg-code px-1 py-0.5 font-mono text-[10px] text-warn" {...props}>
        {children}
      </code>
    )
  }
  return (
    <CodeBlock
      code={String(children).replace(/\n$/, '')}
      lang={match[1]}
      streaming={streaming}
    />
  )
}

const MARKDOWN_COMPONENTS = { code: MarkdownCode }

export function MarkdownContent({ content, streaming = false }: Readonly<Props>): React.JSX.Element {
  return (
    <StreamingContext.Provider value={streaming}>
      <div className="prose-sm text-[11px] leading-relaxed text-fg [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:mb-0.5 [&_strong]:text-fg [&_em]:text-fg-muted [&_a]:text-accent [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-fg-dim">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {content}
        </ReactMarkdown>
      </div>
    </StreamingContext.Provider>
  )
}
