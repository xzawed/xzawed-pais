import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AddWorkspaceDialog } from '../components/AddWorkspaceDialog.js'

afterEach(cleanup)

describe('AddWorkspaceDialog', () => {
  it('로컬 타입 선택 시 경로 입력 필드 표시', () => {
    render(
      <AddWorkspaceDialog
        open={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    // Default type is 'local' — path input should be visible
    expect(screen.getByLabelText(/경로/i)).toBeInTheDocument()
  })

  it('github 타입 선택 시 URL + branch 입력 필드 표시', () => {
    render(
      <AddWorkspaceDialog
        open={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    const githubRadio = screen.getByRole('radio', { name: /GitHub/i })
    fireEvent.click(githubRadio)
    expect(screen.getByLabelText(/URL/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Branch/i)).toBeInTheDocument()
  })

  it('취소 버튼 클릭 시 onClose 호출', () => {
    const onClose = vi.fn()
    render(<AddWorkspaceDialog open={true} onClose={onClose} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /취소/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('open=false이면 렌더링하지 않음', () => {
    render(
      <AddWorkspaceDialog
        open={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
