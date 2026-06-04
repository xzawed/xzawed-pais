import React from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import koApp from '../locales/ko/app.json'
import { ProjectContextBar } from '../components/ProjectContextBar.js'

// i18n 초기화 — t()가 ko 값을 반환하도록 실제 ko/app.json 리소스를 주입한다.
beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'ko', fallbackLng: 'ko', defaultNS: 'app', ns: ['app'],
      interpolation: { escapeValue: false }, resources: {},
    })
  }
  i18n.addResourceBundle('ko', 'app', koApp, true, true)
})

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
