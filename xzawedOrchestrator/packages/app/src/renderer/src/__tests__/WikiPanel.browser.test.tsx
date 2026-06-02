import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getKnowledge = vi.fn()
vi.mock('../lib/api.js', () => ({ getKnowledge: (...a: unknown[]) => getKnowledge(...a) }))

import { WikiPanel } from '../components/WikiPanel.js'

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/p/${projectId}`]}>
      <Routes>
        <Route path="/p/:projectId" element={<WikiPanel />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => getKnowledge.mockReset())

describe('WikiPanel', () => {
  test('지식 항목을 렌더한다', async () => {
    getKnowledge.mockResolvedValue([{ content: '결제는 Stripe', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item')).toBeInTheDocument())
    // plan_task는 출처 필터 옵션에도 있으므로 항목 내부로 한정해 검증
    expect(screen.getByTestId('wiki-item')).toHaveTextContent('결제는 Stripe')
    expect(screen.getByTestId('wiki-item')).toHaveTextContent('plan_task')
  })

  test('category가 있으면 분류 배지를 표시한다', async () => {
    getKnowledge.mockResolvedValue([{ content: '결제는 Stripe', sourceAgent: 'plan_task', category: 'decision', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-category')).toBeInTheDocument())
    expect(screen.getByTestId('wiki-item-category')).toHaveTextContent('decision')
  })

  test('category가 없으면 분류 배지를 표시하지 않는다', async () => {
    getKnowledge.mockResolvedValue([{ content: 'x', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item')).toBeInTheDocument())
    expect(screen.queryByTestId('wiki-item-category')).not.toBeInTheDocument()
  })

  test('빈 상태 안내를 표시하고 항목이 없다', async () => {
    getKnowledge.mockResolvedValue([])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-panel')).toBeInTheDocument())
    expect(screen.queryByTestId('wiki-item')).not.toBeInTheDocument()
  })

  test('검색어 입력 시 query와 함께 재조회한다', async () => {
    getKnowledge.mockResolvedValue([])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-search')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('wiki-search'), { target: { value: 'stripe' } })
    await waitFor(() =>
      expect(getKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', 'stripe', undefined, undefined),
    )
  })

  test('출처 필터 선택 시 source와 함께 재조회한다', async () => {
    getKnowledge.mockResolvedValue([])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-source-filter')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('wiki-source-filter'), { target: { value: 'security_audit' } })
    await waitFor(() =>
      expect(getKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', undefined, 'security_audit', undefined),
    )
  })

  test('분류 필터 선택 시 category와 함께 재조회한다', async () => {
    getKnowledge.mockResolvedValue([])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-category-filter')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('wiki-category-filter'), { target: { value: 'decision' } })
    await waitFor(() =>
      expect(getKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', undefined, undefined, 'decision'),
    )
  })
})
