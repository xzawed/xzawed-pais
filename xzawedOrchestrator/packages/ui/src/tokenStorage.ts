const TOKEN_KEY = 'access_token'

type TokenAPI = {
  tokenGet?: () => Promise<string | null>
  tokenSet?: (token: string) => Promise<void>
  tokenClear?: () => Promise<void>
}

function getElectronTokenAPI(): TokenAPI | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: TokenAPI }).electronAPI
}

export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    const api = getElectronTokenAPI()
    if (api?.tokenGet) return api.tokenGet()
    return sessionStorage.getItem(TOKEN_KEY)
  },

  async setAccessToken(token: string): Promise<void> {
    const api = getElectronTokenAPI()
    if (api?.tokenSet) { await api.tokenSet(token); return }
    sessionStorage.setItem(TOKEN_KEY, token)
  },

  async clearTokens(): Promise<void> {
    const api = getElectronTokenAPI()
    if (api?.tokenClear) { await api.tokenClear(); return }
    sessionStorage.removeItem(TOKEN_KEY)
  },
}
