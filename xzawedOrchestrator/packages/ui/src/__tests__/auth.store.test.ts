import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tokenStorage } from '../tokenStorage.js'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('useAuthStore', () => {
  describe('login', () => {
    it('로그인 성공 시 user와 accessToken을 저장한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: 'u1', email: 'user@test.com' },
          accessToken: 'at_valid',
        }),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null, isLoading: false })

      await useAuthStore.getState().login('http://localhost', 'user@test.com', 'password')

      expect(useAuthStore.getState().user).toEqual({ id: 'u1', email: 'user@test.com' })
      expect(useAuthStore.getState().accessToken).toBe('at_valid')
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('로그인 실패 시 오류를 던지고 isLoading을 복원한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid credentials' }),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null, isLoading: false })

      await expect(
        useAuthStore.getState().login('http://localhost', 'bad@test.com', 'wrong'),
      ).rejects.toThrow('Invalid credentials')
      expect(useAuthStore.getState().isLoading).toBe(false)
    })
  })

  describe('register', () => {
    it('회원가입 성공 시 user와 accessToken을 저장한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: 'u2', email: 'new@test.com', displayName: 'New User' },
          accessToken: 'at_new',
          refreshToken: 'rt_new',
        }),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null, isLoading: false })

      await useAuthStore.getState().register('http://localhost', 'new@test.com', 'password', 'New User')

      expect(useAuthStore.getState().user?.email).toBe('new@test.com')
      expect(useAuthStore.getState().accessToken).toBe('at_new')
    })

    it('회원가입 실패 시 오류를 던진다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Email already exists' }),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await expect(
        useAuthStore.getState().register('http://localhost', 'exists@test.com', 'pass'),
      ).rejects.toThrow('Email already exists')
    })
  })

  describe('logout', () => {
    it('logout 시 user와 accessToken을 초기화한다', async () => {
      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: { id: 'u1', email: 'u@t.com' }, accessToken: 'at_test' })
      await tokenStorage.setAccessToken('at_test')

      await useAuthStore.getState().logout()

      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().accessToken).toBeNull()
      expect(await tokenStorage.getAccessToken()).toBeNull()
    })
  })

  describe('restore', () => {
    it('Electron authRestore가 있으면 user/accessToken을 설정한다', async () => {
      const authRestore = vi.fn().mockResolvedValue({
        user: { id: 'u1', email: 'u@t.com' },
        accessToken: 'at_electron',
      })
      vi.stubGlobal('electronAPI', { authRestore })

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await useAuthStore.getState().restore('http://localhost')

      expect(useAuthStore.getState().user).toEqual({ id: 'u1', email: 'u@t.com' })
      expect(useAuthStore.getState().accessToken).toBe('at_electron')
    })

    it('Electron authRestore가 null user를 반환하면 로그아웃 상태 유지', async () => {
      const authRestore = vi.fn().mockResolvedValue({ user: null })
      vi.stubGlobal('electronAPI', { authRestore })

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await useAuthStore.getState().restore('http://localhost')

      expect(useAuthStore.getState().user).toBeNull()
    })

    it('Electron authRestore 오류 시 로그아웃 상태 유지', async () => {
      const authRestore = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('electronAPI', { authRestore })

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await useAuthStore.getState().restore('http://localhost')

      expect(useAuthStore.getState().user).toBeNull()
    })

    it('token 없으면 restore 없이 반환한다', async () => {
      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await useAuthStore.getState().restore('http://localhost')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('token이 있고 /auth/me 성공 시 user를 설정한다', async () => {
      await tokenStorage.setAccessToken('at_valid')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', email: 'u@t.com' } }),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await useAuthStore.getState().restore('http://localhost')
      expect(useAuthStore.getState().user).not.toBeNull()
    })

    it('/auth/me 실패(비-401) 시 token을 지우고 로그아웃 상태 유지', async () => {
      await tokenStorage.setAccessToken('at_bad')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      }))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await useAuthStore.getState().restore('http://localhost')
      expect(useAuthStore.getState().user).toBeNull()
      expect(await tokenStorage.getAccessToken()).toBeNull()
    })

    it('restore 네트워크 오류 시 조용히 실패한다', async () => {
      await tokenStorage.setAccessToken('at_test')

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const { useAuthStore } = await import('../stores/auth.store.js')
      useAuthStore.setState({ user: null, accessToken: null })

      await expect(useAuthStore.getState().restore('http://localhost')).resolves.not.toThrow()
      expect(useAuthStore.getState().user).toBeNull()
    })
  })
})
