import { useEffect, useRef } from 'react'

interface Props { logs: string[] }

export default function LogStream({ logs }: Readonly<Props>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs])

  return (
    <div ref={ref}
      className="h-32 overflow-y-auto rounded-md bg-black/70 p-2 font-mono text-[10px] text-green-400 border border-[var(--border)]">
      {logs.length === 0
        ? <span className="text-[var(--fg-muted)]">로그 없음</span>
        : logs.map((l, i) => <div key={`${i}:${l}`} className="leading-relaxed whitespace-pre-wrap">{l}</div>)
      }
    </div>
  )
}
