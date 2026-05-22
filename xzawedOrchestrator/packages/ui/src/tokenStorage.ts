const TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'

// tokenGet and refreshTokenGet are intentionally omitted: raw tokens must not be read
// back to the renderer in Electron. Use auth:restore IPC for session restoration.
type TokenAPI = {
  tokenSet?: (token: string) => Promise<void>
  tokenClear?: () => Promise<void>
  refreshTokenSet?: (token: string) => Promise<void>
}

function getElectronTokenAPI(): TokenAPI | undefined {
  return (globalThis as unknown as { electronAPI?: TokenAPI }).electronAPI
}

export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    // In Electron, tokens are not readable back from safeStorage via IPC.
    // Session restoration uses auth:restore which proxies through main.
    return sessionStorage.getItem(TOKEN_KEY)
  },

  async setAccessToken(token: string): Promise<void> {
    const api = getElectronTokenAPI()
    if (api?.tokenSet) { await api.tokenSet(token); return }
    sessionStorage.setItem(TOKEN_KEY, token)
  },

  async getRefreshToken(): Promise<string | null> {
    // In Electron, refresh tokens are not readable back from safeStorage via IPC.
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
