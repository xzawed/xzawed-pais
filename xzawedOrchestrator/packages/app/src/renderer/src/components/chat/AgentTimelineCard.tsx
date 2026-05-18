import React from 'react'
import { motion } from 'framer-motion'
import type { Message } from '@xzawed/shared'
import { parseAgentSteps, type AgentStep, type AgentName } from '../../lib/parseAgentSteps.js'
import { MarkdownContent } from './MarkdownContent.js'
import { cn } from '../../lib/utils.js'

interface Props {
  message: Message
  streaming?: boolean
}

const AGENT_META: Record<AgentName, { icon: string; color: string; bgDone: string; bgActive: string }> = {
  Manager:   { icon: '🎯', color: 'text-agent-mgr',      bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
  Planner:   { icon: '🗺',  color: 'text-agent-planner',  bgDone: 'border-border bg-surface',       bgActive: 'border-ok bg-ok-bg' },
  Developer: { icon: '💻', color: 'text-agent-dev',      bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
  Designer:  { icon: '🎨', color: 'text-agent-designer', bgDone: 'border-border bg-surface',       bgActive: 'border-warn/50 bg-warn/10' },
  Tester:    { icon: '🧪', color: 'text-agent-tester',   bgDone: 'border-border bg-surface',       bgActive: 'border-warn/50 bg-warn/10' },
  Builder:   { icon: '⚙️', color: 'text-agent-builder',  bgDone: 'border-border bg-surface',       bgActive: 'border-agent-builder/40 bg-surface' },
  Watcher:   { icon: '👁',  color: 'text-agent-watcher',  bgDone: 'border-border bg-surface',       bgActive: 'border-agent-watcher/40 bg-surface' },
  Security:  { icon: '🔒', color: 'text-agent-security', bgDone: 'border-border bg-surface',       bgActive: 'border-danger/40 bg-danger/5' },
  Assistant: { icon: '🤖', color: 'text-fg-muted',       bgDone: 'border-border bg-surface',       bgActive: 'border-accent bg-accent-bg' },
}

export function AgentTimelineCard({ message, streaming = false }: Props): React.JSX.Element {
  const steps = parseAgentSteps(message.content, streaming)

  if (steps.length === 0) return <div />

  return (
    <motion.div
      className="flex flex-col gap-0"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Timeline */}
      <div className="relative pl-4">
        {/* Vertical line */}
        <div className="absolute left-1.5 top-3 bottom-3 w-px bg-gradient-to-b from-ok via-accent to-border" />

        {steps.map((step, i) => (
          <TimelineStep
            key={`${step.agentName}-${i}`}
            step={step}
            index={i}
            streaming={streaming}
          />
        ))}
      </div>
    </motion.div>
  )
}

function TimelineStep({ step, index, streaming }: {
  step: AgentStep
  index: number
  streaming: boolean
}): React.JSX.Element {
  const meta = AGENT_META[step.agentName]
  const isActive = step.status === 'active'
  const isDone = step.status === 'done'
  const isWaiting = step.status === 'waiting'

  return (
    <motion.div
      className="relative mb-2"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.25 }}
    >
      {/* Dot */}
      <div className={cn(
        'absolute -left-4 top-2.5 h-2.5 w-2.5 rounded-full border-2',
        isDone    && 'border-ok bg-ok-bg',
        isActive  && 'border-accent bg-accent-bg animate-pulse-glow-blue',
        isWaiting && 'border-border bg-surface opacity-50',
        step.status === 'error' && 'border-danger bg-danger/10',
      )} />

      {/* Card */}
      <div className={cn(
        'rounded-md border px-3 py-2 transition-colors duration-200',
        isDone    && meta.bgDone,
        isActive  && meta.bgActive,
        isWaiting && 'border-border-dim bg-surface opacity-60',
        step.status === 'error' && 'border-danger/40 bg-danger/5',
      )}>
        {/* Header */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[11px]">{meta.icon}</span>
          <span className={cn('text-[10px] font-semibold', meta.color)}>{step.agentName}</span>
          {isDone && (
            <span className="ml-auto rounded-full bg-ok-bg px-1.5 py-0.5 text-[8px] text-ok border border-ok/20">
              ✓ 완료
            </span>
          )}
          {isActive && (
            <span className="ml-auto rounded-full bg-accent-bg px-1.5 py-0.5 text-[8px] text-accent border border-accent/30 animate-pulse-glow-blue">
              ⚡ 진행중
            </span>
          )}
          {isWaiting && (
            <span className="ml-auto text-[8px] text-fg-ghost">대기중</span>
          )}
        </div>

        {/* Content */}
        {step.content && (
          <MarkdownContent content={step.content} streaming={isActive && streaming} />
        )}
        {isWaiting && !step.content && (
          <p className="text-[10px] text-fg-ghost">이전 에이전트 완료 후 시작됩니다.</p>
        )}
      </div>
    </motion.div>
  )
}
