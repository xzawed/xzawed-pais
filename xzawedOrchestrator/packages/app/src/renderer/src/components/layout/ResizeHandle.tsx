import React, { useCallback, useRef } from 'react'

interface Props {
  onResize: (delta: number) => void
}

export function ResizeHandle({ onResize }: Readonly<Props>): React.JSX.Element {
  const dragging = useRef(false)
  const lastX = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      lastX.current = e.clientX

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const delta = ev.clientX - lastX.current
        lastX.current = ev.clientX
        onResize(delta)
      }

      const onUp = () => {
        dragging.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [onResize],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      data-testid="resize-handle"
      className="group relative z-10 flex w-1 flex-shrink-0 cursor-col-resize select-none items-center justify-center bg-transparent transition-colors hover:bg-accent/20 active:bg-accent/30"
      onMouseDown={handleMouseDown}
    >
      <div className="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-accent/50" />
    </div>
  )
}
