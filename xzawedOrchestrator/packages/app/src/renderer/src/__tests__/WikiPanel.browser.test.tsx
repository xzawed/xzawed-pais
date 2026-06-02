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
    expect(screen.getByText(/결제는 Stripe/)).toBeInTheDocument()
    expect(screen.getByText(/plan_task/)).toBeInTheDocument()
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
      expect(getKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', 'stripe'),
    )
  })
})
