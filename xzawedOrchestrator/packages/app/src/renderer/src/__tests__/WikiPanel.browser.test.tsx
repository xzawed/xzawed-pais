import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getKnowledge = vi.fn()
const updateKnowledge = vi.fn()
const deleteKnowledge = vi.fn()
vi.mock('../lib/api.js', () => ({
  getKnowledge: (...a: unknown[]) => getKnowledge(...a),
  updateKnowledge: (...a: unknown[]) => updateKnowledge(...a),
  deleteKnowledge: (...a: unknown[]) => deleteKnowledge(...a),
}))

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

beforeEach(() => {
  getKnowledge.mockReset()
  updateKnowledge.mockReset().mockResolvedValue(undefined)
  deleteKnowledge.mockReset().mockResolvedValue(undefined)
})

describe('WikiPanel', () => {
  test('지식 항목을 렌더한다', async () => {
    getKnowledge.mockResolvedValue([{ id: 1, content: '결제는 Stripe', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item')).toBeInTheDocument())
    // plan_task는 출처 필터 옵션에도 있으므로 항목 내부로 한정해 검증
    expect(screen.getByTestId('wiki-item')).toHaveTextContent('결제는 Stripe')
    expect(screen.getByTestId('wiki-item')).toHaveTextContent('plan_task')
  })

  test('category가 있으면 분류 배지를 표시한다', async () => {
    getKnowledge.mockResolvedValue([{ id: 1, content: '결제는 Stripe', sourceAgent: 'plan_task', category: 'decision', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-category')).toBeInTheDocument())
    expect(screen.getByTestId('wiki-item-category')).toHaveTextContent('decision')
  })

  test('category가 없으면 분류 배지를 표시하지 않는다', async () => {
    getKnowledge.mockResolvedValue([{ id: 1, content: 'x', sourceAgent: 'plan_task', createdAt: 't' }])
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

  test('편집 진입 후 저장 시 updateKnowledge 호출 + 목록 refetch', async () => {
    getKnowledge.mockResolvedValue([{ id: 42, content: '원본', sourceAgent: 'plan_task', category: 'decision', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-edit')).toBeInTheDocument())
    expect(getKnowledge).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('wiki-item-edit'))
    // 편집 버퍼는 원본으로 초기화된다
    expect((screen.getByTestId('wiki-edit-content') as HTMLTextAreaElement).value).toBe('원본')
    expect((screen.getByTestId('wiki-edit-category') as HTMLSelectElement).value).toBe('decision')

    fireEvent.change(screen.getByTestId('wiki-edit-content'), { target: { value: '수정됨' } })
    fireEvent.change(screen.getByTestId('wiki-edit-category'), { target: { value: 'rule' } })
    fireEvent.click(screen.getByTestId('wiki-edit-save'))

    await waitFor(() =>
      expect(updateKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', 42, '수정됨', 'rule'),
    )
    // 저장 후 refetch(최초 1회 + 저장 후 1회 = 2회)
    await waitFor(() => expect(getKnowledge).toHaveBeenCalledTimes(2))
  })

  test('편집 카테고리를 미분류로 비우면 null로 저장한다', async () => {
    getKnowledge.mockResolvedValue([{ id: 7, content: 'x', sourceAgent: 'plan_task', category: 'decision', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-edit')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('wiki-item-edit'))
    fireEvent.change(screen.getByTestId('wiki-edit-category'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('wiki-edit-save'))
    await waitFor(() =>
      expect(updateKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', 7, 'x', null),
    )
  })

  test('편집 취소 시 원본을 복원하고 updateKnowledge를 호출하지 않는다', async () => {
    getKnowledge.mockResolvedValue([{ id: 5, content: '원본 내용', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-edit')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('wiki-item-edit'))
    fireEvent.change(screen.getByTestId('wiki-edit-content'), { target: { value: '버려질 변경' } })
    fireEvent.click(screen.getByTestId('wiki-edit-cancel'))

    // 편집 영역이 사라지고 원본 내용이 다시 표시된다
    await waitFor(() => expect(screen.queryByTestId('wiki-edit-content')).not.toBeInTheDocument())
    expect(screen.getByTestId('wiki-item')).toHaveTextContent('원본 내용')
    expect(updateKnowledge).not.toHaveBeenCalled()
  })

  test('삭제 → in-DOM 확인 → deleteKnowledge 호출 + 목록 refetch', async () => {
    getKnowledge.mockResolvedValue([{ id: 99, content: '삭제 대상', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-delete')).toBeInTheDocument())
    expect(getKnowledge).toHaveBeenCalledTimes(1)

    // 1차 클릭: in-DOM 확인 영역 노출(즉시 삭제 금지)
    fireEvent.click(screen.getByTestId('wiki-item-delete'))
    expect(screen.getByTestId('wiki-delete-confirm')).toBeInTheDocument()
    expect(deleteKnowledge).not.toHaveBeenCalled()

    // 확인 클릭: deleteKnowledge 호출 + refetch
    fireEvent.click(screen.getByTestId('wiki-delete-confirm'))
    await waitFor(() => expect(deleteKnowledge).toHaveBeenCalledWith(expect.any(String), 'p1', 99))
    await waitFor(() => expect(getKnowledge).toHaveBeenCalledTimes(2))
  })

  test('삭제 확인을 취소하면 deleteKnowledge를 호출하지 않는다', async () => {
    getKnowledge.mockResolvedValue([{ id: 11, content: 'x', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-delete')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('wiki-item-delete'))
    expect(screen.getByTestId('wiki-delete-cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wiki-delete-cancel'))

    await waitFor(() => expect(screen.queryByTestId('wiki-delete-confirm')).not.toBeInTheDocument())
    expect(deleteKnowledge).not.toHaveBeenCalled()
  })

  test('편집 content를 비우면 저장 버튼이 비활성화되고 updateKnowledge를 호출하지 않는다', async () => {
    getKnowledge.mockResolvedValue([{ id: 3, content: '원본', sourceAgent: 'plan_task', createdAt: 't' }])
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-edit')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('wiki-item-edit'))
    fireEvent.change(screen.getByTestId('wiki-edit-content'), { target: { value: '   ' } })
    expect(screen.getByTestId('wiki-edit-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('wiki-edit-save'))
    expect(updateKnowledge).not.toHaveBeenCalled()
  })

  test('저장 실패 시 편집 폼이 유지된다(무음 unhandled rejection 방지)', async () => {
    getKnowledge.mockResolvedValue([{ id: 8, content: '원본', sourceAgent: 'plan_task', createdAt: 't' }])
    updateKnowledge.mockRejectedValue(new Error('500'))
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-edit')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('wiki-item-edit'))
    fireEvent.change(screen.getByTestId('wiki-edit-content'), { target: { value: '수정' } })
    fireEvent.click(screen.getByTestId('wiki-edit-save'))
    await waitFor(() => expect(updateKnowledge).toHaveBeenCalled())
    // 실패 → 폼 유지(cancelEdit 미도달), 재시도 가능
    expect(screen.getByTestId('wiki-edit-content')).toBeInTheDocument()
  })

  test('삭제 실패 시 확인 영역이 유지된다(무음 unhandled rejection 방지)', async () => {
    getKnowledge.mockResolvedValue([{ id: 9, content: 'x', sourceAgent: 'plan_task', createdAt: 't' }])
    deleteKnowledge.mockRejectedValue(new Error('502'))
    renderAt('p1')
    await waitFor(() => expect(screen.getByTestId('wiki-item-delete')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('wiki-item-delete'))
    fireEvent.click(screen.getByTestId('wiki-delete-confirm'))
    await waitFor(() => expect(deleteKnowledge).toHaveBeenCalled())
    // 실패 → 확인 영역 유지(setConfirmingId(null) 미도달)
    expect(screen.getByTestId('wiki-delete-confirm')).toBeInTheDocument()
  })
})
