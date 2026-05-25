import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tokenStorage } from '../tokenStorage.js'

// Reset sessionStorage between tests
beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  sessionStorage.clear()
})

describe('tokenStorage — refresh token', () => {
  it('refresh token 저장 후 조회', async () => {
    await tokenStorage.setRefreshToken('rt_abc123')
    const rt = await tokenStorage.getRefreshToken()
    expect(rt).toBe('rt_abc123')
  })

  it('저장되지 않은 경우 null 반환', async () => {
    const rt = await tokenStorage.getRefreshToken()
    expect(rt).toBeNull()
  })

  it('clearTokens 호출 시 refresh token도 제거', async () => {
    await tokenStorage.setAccessToken('at_xxx')
    await tokenStorage.setRefreshToken('rt_xxx')
    await tokenStorage.clearTokens()
    expect(await tokenStorage.getRefreshToken()).toBeNull()
    expect(await tokenStorage.getAccessToken()).toBeNull()
  })
})

describe('auth.store — refresh token 흐름', () => {
  it('login 성공 시 refreshToken 저장', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: 'u1', email: 'a@b.com' },
        accessToken: 'at_new',
        refreshToken: 'rt_new',
      }),
    }))

    const { useAuthStore } = await import('../stores/auth.store.js')
    await useAuthStore.getState().login('http://localhost', 'a@b.com', 'pass123')

    const stored = await tokenStorage.getRefreshToken()
    expect(stored).toBe('rt_new')
  })

  it('restore — 401 시 refresh token으로 자동 갱신', async () => {
    await tokenStorage.setAccessToken('at_expired')
    await tokenStorage.setRefreshToken('rt_valid')

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Token expired' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'at_refreshed',
          refreshToken: 'rt_rotated',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { id: 'u1', email: 'a@b.com' } }),
      })
    )

    const { useAuthStore } = await import('../stores/auth.store.js')
    // Reset store state
    useAuthStore.setState({ user: null, accessToken: null })
    await useAuthStore.getState().restore('http://localhost')

    expect(useAuthStore.getState().user).not.toBeNull()
    expect(useAuthStore.getState().accessToken).toBe('at_refreshed')
    expect(await tokenStorage.getRefreshToken()).toBe('rt_rotated')
  })

  it('restore — refresh token도 없으면 로그아웃 상태 유지', async () => {
    await tokenStorage.setAccessToken('at_expired')
    // No refresh token stored

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Token expired' }) })
    )

    const { useAuthStore } = await import('../stores/auth.store.js')
    useAuthStore.setState({ user: null, accessToken: null })
    await useAuthStore.getState().restore('http://localhost')

    expect(useAuthStore.getState().user).toBeNull()
  })
})
