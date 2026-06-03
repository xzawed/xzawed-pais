import React from 'react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useAppStore } from '../store/app.store.js'
import { SettingsModal } from '../components/SettingsModal.js'
import '../lib/i18n.js'

vi.mock('../lib/i18n.js', async () => {
  const { default: i18n } = await import('i18next')
  const { initReactI18next } = await import('react-i18next')
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        ko: {
          app: {
            settings: {
              title: '설정',
              server_url: '서버 URL',
              mode: '모드',
              mode_local: 'Local',
              mode_remote: 'Remote',
              user_id: '사용자 ID',
              language: '언어',
              lang_ko: '한국어',
              lang_en: 'English',
              lang_ja: '日本語',
              gate_mode: '승인 게이트 모드',
              gate_mode_manual: '모든 단계 수동 승인',
              gate_mode_auto: '모든 단계 자동 통과',
            },
          },
          common: { save: '저장', cancel: '취소' },
        },
      },
      lng: 'ko',
      fallbackLng: 'ko',
      defaultNS: 'app',
      ns: ['app', 'common'],
      interpolation: { escapeValue: false },
    })
  }
  return { default: i18n }
})

vi.stubGlobal('electronAPI', { setSettings: vi.fn().mockResolvedValue(undefined) })

describe('SettingsModal', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { serverUrl: 'http://localhost:3000', mode: 'local', userId: 'user', gateMode: 'manual' },
      showSettings: false,
      locale: 'ko',
    })
  })

  test('showSettings=false 일 때 모달이 렌더링되지 않는다', () => {
    useAppStore.setState({ showSettings: false })
    render(<SettingsModal />)
    expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument()
  })

  test('showSettings=true 일 때 모달이 렌더링된다', () => {
    useAppStore.setState({ showSettings: true })
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
  })

  test('showSettings=true 일 때 설정 입력 필드가 렌더링된다', () => {
    useAppStore.setState({ showSettings: true })
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-server-url')).toBeInTheDocument()
    expect(screen.getByTestId('settings-mode')).toBeInTheDocument()
    expect(screen.getByTestId('settings-user-id')).toBeInTheDocument()
    expect(screen.getByTestId('settings-language')).toBeInTheDocument()
  })

  test('language select 변경 시 setLocale이 호출된다', () => {
    const setLocale = vi.fn()
    useAppStore.setState({ showSettings: true, setLocale })
    render(<SettingsModal />)
    const languageSelect = screen.getByTestId('settings-language')
    fireEvent.change(languageSelect, { target: { value: 'en' } })
    expect(setLocale).toHaveBeenCalledWith('en')
  })

  test('Cancel 버튼 클릭 시 toggleSettings가 호출된다', () => {
    const toggleSettings = vi.fn()
    useAppStore.setState({ showSettings: true, toggleSettings })
    render(<SettingsModal />)
    const cancelButton = screen.getByTestId('settings-cancel')
    fireEvent.click(cancelButton)
    expect(toggleSettings).toHaveBeenCalledOnce()
  })

  test('Save 버튼 클릭 시 updateSettings와 toggleSettings가 호출된다', () => {
    const updateSettings = vi.fn()
    const toggleSettings = vi.fn()
    useAppStore.setState({ showSettings: true, updateSettings, toggleSettings })
    render(<SettingsModal />)
    const saveButton = screen.getByTestId('settings-save')
    fireEvent.click(saveButton)
    expect(updateSettings).toHaveBeenCalledOnce()
    expect(toggleSettings).toHaveBeenCalledOnce()
  })

  test('게이트 모드 select가 렌더되고 변경 후 저장 시 gateMode가 반영된다', () => {
    const updateSettings = vi.fn()
    useAppStore.setState({ showSettings: true, updateSettings })
    render(<SettingsModal />)
    const sel = screen.getByTestId('settings-gate-mode') as HTMLSelectElement
    expect(sel).toBeInTheDocument()
    expect(sel.value).toBe('manual')
    fireEvent.change(sel, { target: { value: 'auto' } })
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ gateMode: 'auto' }))
  })

  test('서버 URL 입력 변경이 반영된다', () => {
    useAppStore.setState({ showSettings: true })
    render(<SettingsModal />)
    const urlInput = screen.getByTestId('settings-server-url') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'http://localhost:9999' } })
    expect(urlInput.value).toBe('http://localhost:9999')
  })
})
