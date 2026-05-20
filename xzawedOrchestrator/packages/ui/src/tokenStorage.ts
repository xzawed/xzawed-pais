const TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'

type TokenAPI = {
  tokenGet?: () => Promise<string | null>
  tokenSet?: (token: string) => Promise<void>
  tokenClear?: () => Promise<void>
  refreshTokenGet?: () => Promise<string | null>
  refreshTokenSet?: (token: string) => Promise<void>
}

function getElectronTokenAPI(): TokenAPI | undefined {
  return (globalThis as unknown as { electronAPI?: TokenAPI }).electronAPI
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

  async getRefreshToken(): Promise<string | null> {
    const api = getElectronTokenAPI()
    if (api?.refreshTokenGet) return api.refreshTokenGet()
    return sessionStorage.getItem(REFRESH_TOKEN_KEY)
  },

  async setRefreshToken(token: string): Promise<void> {
    const api = getElectronTokenAPI()
    if (api?.refreshTokenSet) { await api.refreshTokenSet(token); return }
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token)
  },

  async clearTokens(): Promise<void> {
    const api = getElectronTokenAPI()
    if (api?.tokenClear) { await api.tokenClear(); return }
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  },
}
