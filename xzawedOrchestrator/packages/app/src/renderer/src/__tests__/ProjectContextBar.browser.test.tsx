import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectContextBar } from '../components/ProjectContextBar.js'

describe('ProjectContextBar', () => {
  it('projectName이 있을 때 이름 표시', () => {
    render(
      <ProjectContextBar
        projectName="my-shopping-mall"
        workspacePath="/home/user/shopping"
        workspaceType="local"
        onSwitch={vi.fn()}
      />
    )
    expect(screen.getByText('my-shopping-mall')).toBeInTheDocument()
  })

  it('projectName이 없을 때 "(프로젝트 없음)" 표시', () => {
    render(
      <ProjectContextBar
        projectName={null}
        workspacePath={null}
        workspaceType={null}
        onSwitch={vi.fn()}
      />
    )
    expect(screen.getByText(/프로젝트 없음/i)).toBeInTheDocument()
  })

  it('클릭 시 onSwitch 호출', () => {
    const onSwitch = vi.fn()
    render(
      <ProjectContextBar
        projectName="my-app"
        workspacePath="/home/user/app"
        workspaceType="local"
        onSwitch={onSwitch}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onSwitch).toHaveBeenCalledOnce()
  })
})
