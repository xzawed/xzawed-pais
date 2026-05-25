import React from 'react'
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AgentStep } from '../lib/parseAgentSteps.js'
import { PipelineStrip } from '../components/chat/PipelineStrip.js'

const steps: AgentStep[] = [
  { agentName: 'Manager', status: 'done', content: '' },
  { agentName: 'Planner', status: 'active', content: '계획 수립 중' },
  { agentName: 'Developer', status: 'waiting', content: '' },
]

describe('PipelineStrip', () => {
  test('renders pipeline steps with indexed testids', () => {
    render(<PipelineStrip steps={steps} />)
    expect(screen.getByTestId('pipeline-step-0')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-step-1')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-step-2')).toBeInTheDocument()
  })

  test('renders nothing when steps array is empty', () => {
    const { container } = render(<PipelineStrip steps={[]} />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })

  test('shows agent names in the pipeline', () => {
    render(<PipelineStrip steps={steps} />)
    expect(screen.getByText(/Manager/)).toBeInTheDocument()
    expect(screen.getByText(/Planner/)).toBeInTheDocument()
  })
})
