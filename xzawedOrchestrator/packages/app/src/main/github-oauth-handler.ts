import http from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { shell, safeStorage, app } from 'electron'
import type { BrowserWindow } from 'electron'

const CALLBACK_PORT = 54321

function tokenFilePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'github-token.enc')
}

export function storeToken(token: string): void {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token)
  writeFileSync(tokenFilePath(), buf.toString('base64'), 'utf-8')
}

export function getStoredToken(): string | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    const b64 = readFileSync(path, 'utf-8')
    const buf = Buffer.from(b64, 'base64')
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString()
  } catch {
    return null
  }
}

export function clearToken(): void {
  writeFileSync(tokenFilePath(), '', 'utf-8')
}

async function exchangeCode(code: string): Promise<string> {
  const clientId     = process.env['GITHUB_CLIENT_ID']     ?? ''
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'] ?? ''
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(data.error ?? 'Token exchange failed')
  return data.access_token
}

export async function fetchGitHubUser(token: string): Promise<{ login: string; avatar_url: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub user fetch failed: ${res.status}`)
  return res.json() as Promise<{ login: string; avatar_url: string }>
}

export async function fetchUserRepos(token: string): Promise<Array<{ id: number; name: string; full_name: string; private: boolean; default_branch: string }>> {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`Repos fetch failed: ${res.status}`)
  return res.json() as Promise<Array<{ id: number; name: string; full_name: string; private: boolean; default_branch: string }>>
}

export function startOAuthFlow(mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauthState = randomBytes(32).toString('hex')
    let settled = false
    let oauthTimeout: ReturnType<typeof setTimeout> | undefined

    const done = (err: unknown, value?: string) => {
      if (settled) return
      settled = true
      if (oauthTimeout !== undefined) clearTimeout(oauthTimeout)
      server.close()
      if (err !== null && err !== undefined) reject(err instanceof Error ? err : new Error(String(err)))
      else resolve(value ?? '')
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404); res.end(); return
      }

      const returnedState = url.searchParams.get('state')
      if (!returnedState || returnedState !== oauthState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('OAuth state mismatch — possible CSRF attack')
        done(new Error('OAuth state mismatch'))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400); res.end('Missing code')
        done(new Error('Missing code in OAuth callback'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>✅ 인증 완료! 앱으로 돌아가세요.</h2></body></html>')

      try {
        const token = await exchangeCode(code)
        storeToken(token)
        mainWindow.webContents.send('github:auth-complete')
        done(null, token)
      } catch (err) {
        done(err)
      }
    })

    oauthTimeout = setTimeout(() => {
      done(new Error('OAuth flow timed out after 5 minutes'))
    }, 5 * 60 * 1000)

    server.listen(CALLBACK_PORT, () => {
      const clientId = process.env['GITHUB_CLIENT_ID'] ?? ''
      const authUrl =
        `https://github.com/login/oauth/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&scope=repo,user` +
        `&redirect_uri=http://localhost:${CALLBACK_PORT}/callback` +
        `&state=${oauthState}`
      // Verify URL targets the expected GitHub OAuth endpoint before opening
      if (!authUrl.startsWith('https://github.com/login/oauth/authorize?')) {
        done(new Error('Unexpected OAuth URL — aborting'))
        return
      }
      shell.openExternal(authUrl).catch((err: unknown) => done(err))
    })

    server.on('error', (err) => done(err))
  })
}
