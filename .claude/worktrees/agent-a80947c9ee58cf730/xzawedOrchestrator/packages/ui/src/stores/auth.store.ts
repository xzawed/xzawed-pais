import { create } from 'zustand'
import { tokenStorage } from '../tokenStorage.js'

export interface AuthUser {
  id: string
  email: string
  displayName?: string | undefined
}

async function fetchAuth(
  url: string,
  body: Record<string, string | undefined>,
  defaultError: string,
): Promise<{ user: AuthUser; accessToken: string; refreshToken?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = (await res.json()) as { error?: string }
    throw new Error(b.error ?? defaultError)
  }
  return (await res.json()) as { user: AuthUser; accessToken: string; refreshToken?: string }
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isLoading: boolean
  login: (serverUrl: string, email: string, password: string) => Promise<void>
  register: (serverUrl: string, email: string, password: string, displayName?: string) => Promise<void>
  logout: () => Promise<void>
  restore: (serverUrl: string) => Promise<void>
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  isLoading: false,

  login: async (serverUrl, email, password) => {
    set({ isLoading: true })
    try {
      const { user, accessToken, refreshToken } = await fetchAuth(
        `${serverUrl}/auth/login`,
        { email, password },
        'Login failed',
      )
      await tokenStorage.setAccessToken(accessToken)
      if (refreshToken) await tokenStorage.setRefreshToken(refreshToken)
      set({ user, accessToken, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  register: async (serverUrl, email, password, displayName) => {
    set({ isLoading: true })
    try {
      const { user, accessToken, refreshToken } = await fetchAuth(
        `${serverUrl}/auth/register`,
        { email, password, displayName },
        'Registration failed',
      )
      await tokenStorage.setAccessToken(accessToken)
      if (refreshToken) await tokenStorage.setRefreshToken(refreshToken)
      set({ user, accessToken, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  logout: async () => {
    await tokenStorage.clearTokens()
    set({ user: null, accessToken: null })
  },

  restore: async (serverUrl) => {
    // In Electron, delegate the entire restore flow to main process via auth:restore.
    // This keeps raw tokens off the renderer and avoids the need to read them back.
    type ElectronAuthAPI = {
      authRestore?: (url: string) => Promise<{ user: AuthUser; accessToken: string } | null>
    }
    const electronAPI = (globalThis as unknown as { electronAPI?: ElectronAuthAPI }).electronAPI
    if (electronAPI?.authRestore) {
      try {
        const result = await electronAPI.authRestore(serverUrl)
        if (result) {
          await tokenStorage.setAccessToken(result.accessToken)
          set({ user: result.user, accessToken: result.accessToken })
        }
      } catch {
        // network error in main process — keep state as-is
      }
      return
    }

    // Web / non-Electron path: read token from sessionStorage and call server directly.
    const token = await tokenStorage.getAccessToken()
    if (!token) return
    try {
      const res = await fetch(`${serverUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { user } = (await res.json()) as { user: AuthUser }
        set({ user, accessToken: token })
        return
      }
      if (res.status === 401) {
        const refreshToken = await tokenStorage.getRefreshToken()
        if (!refreshToken) { await tokenStorage.clearTokens(); return }
        const refreshRes = await fetch(`${serverUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!refreshRes.ok) { await tokenStorage.clearTokens(); return }
        const { accessToken: newAt, refreshToken: newRt } =
          (await refreshRes.json()) as { accessToken: string; refreshToken: string }
        await tokenStorage.setAccessToken(newAt)
        await tokenStorage.setRefreshToken(newRt)
        const meRes = await fetch(`${serverUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${newAt}` },
        })
        if (meRes.ok) {
          const { user } = (await meRes.json()) as { user: AuthUser }
          set({ user, accessToken: newAt })
        } else {
          await tokenStorage.clearTokens()
        }
        return
      }
      await tokenStorage.clearTokens()
    } catch {
      // network error — keep token for retry, don't set user
    }
  },
}))
