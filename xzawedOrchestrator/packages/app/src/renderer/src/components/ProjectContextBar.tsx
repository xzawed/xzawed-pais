import React from 'react'

interface Props {
  projectName: string | null
  workspacePath: string | null
  workspaceType: 'none' | 'local' | 'github' | null
  onSwitch: () => void
}

function WorkspaceIcon({ type }: Readonly<{ type: 'none' | 'local' | 'github' | null }>): React.JSX.Element {
  if (type === 'github') return <span>🐙</span>
  if (type === 'local') return <span>📁</span>
  return <span>○</span>
}

export function ProjectContextBar({ projectName, workspacePath, workspaceType, onSwitch }: Readonly<Props>): React.JSX.Element {
  return (
    <div className="flex items-center border-t border-border px-3 py-1">
      <button
        type="button"
        onClick={onSwitch}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg"
        title={workspacePath ?? undefined}
      >
        <WorkspaceIcon type={workspaceType} />
        <span>{projectName ?? '(프로젝트 없음)'}</span>
        <span className="opacity-50">▾</span>
      </button>
    </div>
  )
}
