import { create } from 'zustand'
import { tokenStorage } from '../tokenStorage.js'

export interface AuthUser {
  id: string
  email: string
  displayName?: string | undefined
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
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Login failed')
      }
      const { user, accessToken } = (await res.json()) as { user: AuthUser; accessToken: string }
      await tokenStorage.setAccessToken(accessToken)
      set({ user, accessToken, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  register: async (serverUrl, email, password, displayName) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`${serverUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Registration failed')
      }
      const { user, accessToken } = (await res.json()) as { user: AuthUser; accessToken: string }
      await tokenStorage.setAccessToken(accessToken)
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
    const token = await tokenStorage.getAccessToken()
    if (!token) return
    try {
      const res = await fetch(`${serverUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { user } = (await res.json()) as { user: AuthUser }
        set({ user, accessToken: token })
      } else {
        await tokenStorage.clearTokens()
      }
    } catch {
      // network error — keep token for retry, don't set user
    }
  },
}))
