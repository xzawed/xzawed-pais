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

  test('options 미제공 시 DEFAULT_CHOICES 폴백 렌더(레거시·malformed 경로)', async () => {
    // BRIEF는 context.options가 없어 DEFAULT_CHOICES(4종) 폴백을 탄다 — options 컬럼 도입 전 레거시 행/
    // malformed context의 우아한 강등 경로. 실 defect_brief는 options:['fix_reverify']를 싣는다(아래 테스트).
    getPendingDecisions.mockResolvedValue([BRIEF])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('decisions-item')).toBeInTheDocument())
    expect(screen.getByTestId('decisions-item')).toHaveTextContent('WP wp-a (step 3)')
    expect(screen.getByTestId('decision-submit-fix_reverify')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-spec_fix')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-accept_known')).toBeInTheDocument()
    expect(screen.getByTestId('decision-submit-reject')).toBeInTheDocument()
  })

  test('실 defect_brief(options=[fix_reverify])는 fix_reverify 버튼만 렌더(D10)', async () => {
    // D10: buildDefectBrief가 핸들러 있는 choice만 노출 → defect_brief 카드는 fix_reverify 한 개만.
    getPendingDecisions.mockResolvedValue([{ ...BRIEF, context: { ...BRIEF.context, options: ['fix_reverify'] } }])
    renderAt('p1')
    expect(await screen.findByTestId('decision-submit-fix_reverify')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-submit-spec_fix')).not.toBeInTheDocument()
    expect(screen.queryByTestId('decision-submit-accept_known')).not.toBeInTheDocument()
    expect(screen.queryByTestId('decision-submit-reject')).not.toBeInTheDocument()
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

  test('서로 다른 type의 결정 카드는 구별되는 type 배지를 렌더한다', async () => {
    // 4종 라이브 type(defect_brief·risk_classification·degraded_release·degraded_dispatch)이
    // 본문 자유텍스트로만 구별되면 고위험 사인오프 오조작 위험 → 카드에 type 배지를 노출한다.
    getPendingDecisions.mockResolvedValue([
      { requestId: 'r1', type: 'risk_classification', context: { options: ['approve', 'reject'] } },
      { requestId: 'r2', type: 'defect_brief', context: { options: ['fix_reverify'] } },
    ])
    renderAt('p1')
    await waitFor(() => expect(screen.getAllByTestId('decision-type')).toHaveLength(2))
    const [b1, b2] = screen.getAllByTestId('decision-type')
    expect(b1.textContent?.trim()).toBeTruthy()
    expect(b2.textContent?.trim()).toBeTruthy()
    expect(b1.textContent).not.toBe(b2.textContent) // type별 구별되는 라벨(로케일 무관)
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
