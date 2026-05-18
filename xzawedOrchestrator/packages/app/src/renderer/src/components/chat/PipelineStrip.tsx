import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AgentStep } from '../../lib/parseAgentSteps.js'
import { cn } from '../../lib/utils.js'

interface Props {
  steps: AgentStep[]
}

export function PipelineStrip({ steps }: Props): React.JSX.Element {
  if (steps.length === 0) return <div />

  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-4 py-1.5 overflow-x-auto">
      <span className="mr-1 flex-shrink-0 text-[9px] text-fg-ghost">파이프라인</span>
      {steps.map((step, i) => (
        <React.Fragment key={`${step.agentName}-${i}`}>
          {i > 0 && (
            <div className={cn(
              'h-px w-3 flex-shrink-0',
              steps[i - 1].status === 'done' ? 'bg-ok' : 'bg-border'
            )} />
          )}
          <AnimatePresence mode="wait">
            <motion.div
              layout
              key={step.status}
              data-testid={`pipeline-step-${i}`}
              className={cn(
                'flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] border transition-colors duration-300',
                step.status === 'done'  && 'bg-ok-bg text-ok border-ok/30',
                step.status === 'active' && 'bg-accent-bg text-accent border-accent/40 animate-pulse-glow-blue',
                step.status === 'waiting' && 'bg-surface text-fg-ghost border-border',
                step.status === 'error'  && 'bg-danger/10 text-danger border-danger/30',
              )}
            >
              {step.status === 'done'   && '✓ '}
              {step.status === 'active' && '⚡ '}
              {step.status === 'waiting' && '○ '}
              {step.agentName}
            </motion.div>
          </AnimatePresence>
        </React.Fragment>
      ))}
    </div>
  )
}
