import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tokenStorage } from '../tokenStorage.js'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  sessionStorage.clear()
})

describe('tokenStorage', () => {
  describe('getAccessToken', () => {
    it('저장된 access token을 반환한다', async () => {
      sessionStorage.setItem('access_token', 'at_test')
      const token = await tokenStorage.getAccessToken()
      expect(token).toBe('at_test')
    })

    it('없으면 null을 반환한다', async () => {
      const token = await tokenStorage.getAccessToken()
      expect(token).toBeNull()
    })
  })

  describe('setAccessToken', () => {
    it('sessionStorage에 access token을 저장한다', async () => {
      await tokenStorage.setAccessToken('at_new')
      expect(sessionStorage.getItem('access_token')).toBe('at_new')
    })

    it('Electron API가 있으면 tokenSet을 호출한다', async () => {
      const tokenSet = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('electronAPI', { tokenSet })

      await tokenStorage.setAccessToken('at_electron')
      expect(tokenSet).toHaveBeenCalledWith('at_electron')
      expect(sessionStorage.getItem('access_token')).toBeNull()

      vi.unstubAllGlobals()
    })
  })

  describe('getRefreshToken', () => {
    it('저장된 refresh token을 반환한다', async () => {
      sessionStorage.setItem('refresh_token', 'rt_test')
      const token = await tokenStorage.getRefreshToken()
      expect(token).toBe('rt_test')
    })

    it('없으면 null을 반환한다', async () => {
      const token = await tokenStorage.getRefreshToken()
      expect(token).toBeNull()
    })
  })

  describe('setRefreshToken', () => {
    it('sessionStorage에 refresh token을 저장한다', async () => {
      await tokenStorage.setRefreshToken('rt_new')
      expect(sessionStorage.getItem('refresh_token')).toBe('rt_new')
    })

    it('Electron API가 있으면 refreshTokenSet을 호출한다', async () => {
      const refreshTokenSet = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('electronAPI', { refreshTokenSet })

      await tokenStorage.setRefreshToken('rt_electron')
      expect(refreshTokenSet).toHaveBeenCalledWith('rt_electron')
      expect(sessionStorage.getItem('refresh_token')).toBeNull()

      vi.unstubAllGlobals()
    })
  })

  describe('clearTokens', () => {
    it('access token과 refresh token을 모두 삭제한다', async () => {
      sessionStorage.setItem('access_token', 'at_test')
      sessionStorage.setItem('refresh_token', 'rt_test')

      await tokenStorage.clearTokens()

      expect(sessionStorage.getItem('access_token')).toBeNull()
      expect(sessionStorage.getItem('refresh_token')).toBeNull()
    })

    it('Electron API가 있으면 tokenClear를 호출한다', async () => {
      const tokenClear = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('electronAPI', { tokenClear })

      sessionStorage.setItem('access_token', 'at_test')
      await tokenStorage.clearTokens()
      expect(tokenClear).toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })
})
