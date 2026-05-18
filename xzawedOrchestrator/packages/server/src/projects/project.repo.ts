import type { Pool } from 'pg'

export interface Project {
  id: string
  userId: string
  name: string
  slug: string
  description: string | null
  githubOwner: string | null
  githubRepo: string | null
  githubBranch: string
  createdAt: Date
  updatedAt: Date
}

export interface ProjectUpdate {
  name?: string
  description?: string | null
  githubOwner?: string | null
  githubRepo?: string | null
  githubBranch?: string
}

interface ProjectRow {
  id: string
  user_id: string
  name: string
  slug: string
  description: string | null
  github_owner: string | null
  github_repo: string | null
  github_branch: string
  created_at: Date
  updated_at: Date
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubBranch: row.github_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export class ProjectRepo {
  constructor(private readonly pool: Pool) {}

  async create(
    userId: string,
    name: string,
    options: {
      description?: string
      githubOwner?: string
      githubRepo?: string
      githubBranch?: string
      slug?: string
    } = {}
  ): Promise<Project> {
    const slug = options.slug ?? toSlug(name)
    const { rows } = await this.pool.query<ProjectRow>(
      `INSERT INTO projects (user_id, name, slug, description, github_owner, github_repo, github_branch)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        name,
        slug,
        options.description ?? null,
        options.githubOwner ?? null,
        options.githubRepo ?? null,
        options.githubBranch ?? 'main',
      ]
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create project')
    return rowToProject(row)
  }

  async findByUser(userId: string): Promise<Project[]> {
    const { rows } = await this.pool.query<ProjectRow>(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    )
    return rows.map(rowToProject)
  }

  async findById(id: string): Promise<Project | undefined> {
    const { rows } = await this.pool.query<ProjectRow>(
      'SELECT * FROM projects WHERE id = $1',
      [id]
    )
    const row = rows[0]
    return row ? rowToProject(row) : undefined
  }

  async update(id: string, update: ProjectUpdate): Promise<Project> {
    const { rows } = await this.pool.query<ProjectRow>(
      `UPDATE projects SET
        name          = COALESCE($2, name),
        description   = CASE WHEN $3::boolean THEN $4 ELSE description END,
        github_owner  = CASE WHEN $5::boolean THEN $6 ELSE github_owner END,
        github_repo   = CASE WHEN $7::boolean THEN $8 ELSE github_repo END,
        github_branch = COALESCE($9, github_branch),
        updated_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        update.name ?? null,
        'description' in update,
        update.description ?? null,
        'githubOwner' in update,
        update.githubOwner ?? null,
        'githubRepo' in update,
        update.githubRepo ?? null,
        update.githubBranch ?? null,
      ]
    )
    const row = rows[0]
    if (!row) throw new Error('Project not found')
    return rowToProject(row)
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM projects WHERE id = $1', [id])
  }
}
