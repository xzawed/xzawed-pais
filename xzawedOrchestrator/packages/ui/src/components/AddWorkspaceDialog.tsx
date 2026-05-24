import React, { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (data: {
    workspaceType: 'local' | 'github'
    localPath?: string
    repoUrl?: string
    branch?: string
    pushStrategy: 'push' | 'pr'
  }) => Promise<void>
}

function GithubFields({
  repoUrl,
  branch,
  onRepoUrlChange,
  onBranchChange,
}: Readonly<{
  repoUrl: string
  branch: string
  onRepoUrlChange: (v: string) => void
  onBranchChange: (v: string) => void
}>): React.JSX.Element {
  return (
    <>
      <div className="mb-3">
        <label htmlFor="ws-repo-url" className="mb-1 block text-sm font-medium">
          URL
        </label>
        <input
          id="ws-repo-url"
          value={repoUrl}
          onChange={(e) => onRepoUrlChange(e.target.value)}
          placeholder="https://github.com/user/repo"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4">
        <label htmlFor="ws-branch" className="mb-1 block text-sm font-medium">
          Branch
        </label>
        <input
          id="ws-branch"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          placeholder="main"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      </div>
    </>
  )
}

export function AddWorkspaceDialog({ open, onClose, onSave }: Readonly<Props>): React.JSX.Element | null {
  const [type, setType] = useState<'local' | 'github'>('local')
  const [localPath, setLocalPath] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [pushStrategy, setPushStrategy] = useState<'push' | 'pr'>('push')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave({
        workspaceType: type,
        ...(type === 'local' ? { localPath } : { repoUrl, branch }),
        pushStrategy,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg"
      >
        <h2 className="mb-4 text-base font-semibold text-fg">워크스페이스 설정</h2>

        {error !== null && <p className="mb-3 text-sm text-red-500">{error}</p>}

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium">유형</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ws-type"
              value="local"
              checked={type === 'local'}
              onChange={() => setType('local')}
              aria-label="로컬 디렉토리"
            />
            로컬 디렉토리
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ws-type"
              value="github"
              checked={type === 'github'}
              onChange={() => setType('github')}
              aria-label="GitHub 리포지토리"
            />
            GitHub 리포지토리
          </label>
        </fieldset>

        {type === 'local' && (
          <div className="mb-4">
            <label htmlFor="ws-local-path" className="mb-1 block text-sm font-medium">
              경로
            </label>
            <input
              id="ws-local-path"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/home/user/my-project"
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
        )}

        {type === 'github' && (
          <GithubFields
            repoUrl={repoUrl}
            branch={branch}
            onRepoUrlChange={setRepoUrl}
            onBranchChange={setBranch}
          />
        )}

        <div className="mb-4">
          <label htmlFor="ws-push-strategy" className="mb-1 block text-sm font-medium">
            변경사항 반영 방식
          </label>
          <select
            id="ws-push-strategy"
            value={pushStrategy}
            onChange={(e) => setPushStrategy(e.target.value as 'push' | 'pr')}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          >
            <option value="push">직접 Push</option>
            <option value="pr">Pull Request 생성</option>
          </select>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
