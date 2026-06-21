import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getPendingDecisions = vi.fn()
const submitDecision = vi.fn()
vi.mock('../lib/api.js', () => ({
  getPendingDecisions: (...a: unknown[]) => getPendingDecisions(...a),
  submitDecision: (...a: unknown[]) => submitDecision(...a),
}))

import { useAuthStore } from '@xzawed/ui'
import { DecisionsPanel } from '../components/DecisionsPanel.js'

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/p/${projectId}`]}>
      <Routes>
        <Route path="/p/:projectId" element={<DecisionsPanel />} />
      </Routes>
    </MemoryRouter>,
  )
}

const BRIEF = {
  requestId: 'wf-1:wp-a:2',
  type: 'defect_brief',
  context: { location: 'WP wp-a (step 3)', expectedVsActual: '구현 3회 실패', impact: ['후행 차단'], evidenceRefs: ['wp.escalated@wf-1/wp-a'] },
}

beforeEach(() => {
  getPendingDecisions.mockReset().mockResolvedValue([])
  submitDecision.mockReset().mockResolvedValue(undefined)
  useAuthStore.setState({ accessToken: null })
})

describe('DecisionsPanel', () => {
  test('pending 결정이 없으면 empty 표시', async () => {
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('decisions-empty')).toBeInTheDocument())
  })

  test('defect_brief 카드를 렌더(위치·기대vs실제·4 choice)', async () => {
    getPendingDecisions.mockResolvedValue([BRIEF])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('decisions-item')).toBeInTheDocument())
    expect(screen.getByTestId('decisions-item')).toHaveTextContent('WP wp-a (step 3)')
    expect(screen.getByTestId('decision-submit-fix_reverify')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-spec_fix')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-accept_known')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-reject')).toBeInTheDocument()
  })

  test('fix_reverify 클릭 시 submitDecision(requestId, fix_reverify) 호출 + refetch', async () => {
    getPendingDecisions.mockResolvedValueOnce([BRIEF]).mockResolvedValueOnce([])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('decision-submit-fix_reverify')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('decision-submit-fix_reverify'))
    await waitFor(() => expect(submitDecision).toHaveBeenCalledWith(
      expect.any(String), 'p1', 'wf-1:wp-a:2', 'fix_reverify', undefined, undefined,
    ))
    await waitFor(() => expect(getPendingDecisions).toHaveBeenCalledTimes(2)) // 초기 + 제출 후 refetch
  })

  test('새로고침 버튼이 getPendingDecisions 재호출', async () => {
    getPendingDecisions.mockResolvedValue([])
    renderAt('p1')
    await waitFor(() => expect(getPendingDecisions).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('decisions-refresh'))
    await waitFor(() => expect(getPendingDecisions).toHaveBeenCalledTimes(2))
  })

  test('attribution이 있으면 카드에 faultTier를 렌더', async () => {
    getPendingDecisions.mockResolvedValue([{
      ...BRIEF,
      context: { ...BRIEF.context, attribution: { faultTier: 'impl_exhausted', counters: { impl: 3, task: 0, plan: 0 } } },
    }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('decisions-item')).toHaveTextContent('impl_exhausted'))
  })

  test('context.options를 버튼으로 렌더한다(risk_classification approve/reject)', async () => {
    getPendingDecisions.mockResolvedValue([{
      requestId: 'wf:risk:1',
      type: 'risk_classification',
      context: { options: ['approve', 'reject'], expectedVsActual: 'risk=HIGH...' },
    }])
    renderAt('p1')
    expect(await screen.findByTestId('decision-submit-approve')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-reject')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-submit-fix_reverify')).not.toBeInTheDocument()
  })
})
