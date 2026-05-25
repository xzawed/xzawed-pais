import type { Pool } from 'pg'
import { encryptToken, decryptToken } from './github-token.crypto.js'

interface TokenRow {
  token_cipher: Buffer
  token_iv: Buffer
  token_tag: Buffer
  scopes: string[] | null
  rotated_at: Date | null
}

export async function getGithubToken(
  projectId: string,
  pool: Pool,
  encryptionKey: string
): Promise<string | null> {
  const res = await pool.query<TokenRow>(
    'SELECT token_cipher, token_iv, token_tag FROM project_github_tokens WHERE project_id = $1',
    [projectId]
  )
  const row = res.rows[0]
  if (!row) return null
  return decryptToken({ cipher: row.token_cipher, iv: row.token_iv, tag: row.token_tag }, encryptionKey)
}

export async function upsertGithubToken(
  projectId: string,
  token: string,
  pool: Pool,
  encryptionKey: string,
  scopes?: string[]
): Promise<void> {
  const { cipher, iv, tag } = encryptToken(token, encryptionKey)
  await pool.query(
    `INSERT INTO project_github_tokens (project_id, token_cipher, token_iv, token_tag, scopes, rotated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (project_id) DO UPDATE
       SET token_cipher = EXCLUDED.token_cipher,
           token_iv     = EXCLUDED.token_iv,
           token_tag    = EXCLUDED.token_tag,
           scopes       = EXCLUDED.scopes,
           rotated_at   = NOW()`,
    [projectId, cipher, iv, tag, scopes ?? null]
  )
}

export async function deleteGithubToken(projectId: string, pool: Pool): Promise<void> {
  await pool.query('DELETE FROM project_github_tokens WHERE project_id = $1', [projectId])
}
