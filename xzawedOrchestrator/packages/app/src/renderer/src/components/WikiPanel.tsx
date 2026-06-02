import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { deleteKnowledge, getKnowledge, updateKnowledge, type KnowledgeItem } from '../lib/api.js'
import { useAppStore } from '../store/app.store.js'

/** 도메인 지식 의미 분류 리터럴(필터·편집 드롭다운이 공유하는 단일 소스). */
const CATEGORIES = ['decision', 'constraint', 'rule', 'tech'] as const

/** 위키 자동 갱신 폴링 주기(ms). 데스크톱 PO 도구라 보수적. */
export const WIKI_POLL_MS = 10_000

/** 프로젝트에 누적된 도메인 지식을 표시하고 PO가 인라인 편집·삭제하는 패널(위키). */
export function WikiPanel(): React.JSX.Element {
  const { t } = useTranslation('app')
  const { settings } = useAppStore()
  const { projectId } = useParams<{ projectId?: string }>()
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('')
  // 편집 상태: 편집 중인 항목 id와 편집 버퍼(content/category)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  // 삭제 확인 상태: 확인 영역을 노출 중인 항목 id
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  // 변이(편집·삭제) 성공 후 refetch를 useEffect의 active-signal 경로로 강제(stale 결과 clobber 방지)
  const [refreshKey, setRefreshKey] = useState(0)

  /** 현재 필터 기준으로 지식 목록을 조회한다(편집·삭제 후 refetch 단일 재사용). */
  const fetchKnowledge = useCallback(
    (signal?: { active: boolean }): Promise<void> => {
      if (!projectId) {
        setItems([])
        return Promise.resolve()
      }
      const q = query.trim()
      return getKnowledge(
        settings.serverUrl,
        projectId,
        q || undefined,
        source || undefined,
        category || undefined,
      ).then((r) => {
        if (!signal || signal.active) setItems(r)
      })
    },
    [projectId, settings.serverUrl, query, source, category, refreshKey],
  )

  useEffect(() => {
    const signal = { active: true }
    void fetchKnowledge(signal)
    return () => {
      signal.active = false
    }
  }, [fetchKnowledge])

  // 자동 갱신: WIKI_POLL_MS마다 refreshKey를 bump해 가드 refetch 경로 재사용.
  // 편집/삭제 확인 중엔 폴링 중단(진행 중 버퍼·확인 UI를 refetch가 흔들지 않도록).
  useEffect(() => {
    if (!projectId || editingId !== null || confirmingId !== null) return
    const timer = setInterval(() => setRefreshKey((n) => n + 1), WIKI_POLL_MS)
    return () => clearInterval(timer)
  }, [projectId, editingId, confirmingId])

  function startEdit(it: KnowledgeItem): void {
    setConfirmingId(null)
    setEditingId(it.id)
    setEditContent(it.content)
    setEditCategory(it.category ?? '')
  }

  function cancelEdit(): void {
    // 원본 복원: 버퍼만 비우면 렌더는 it.* 원본을 다시 표시
    setEditingId(null)
    setEditContent('')
    setEditCategory('')
  }

  async function saveEdit(id: number): Promise<void> {
    if (!projectId) return
    const content = editContent.trim()
    if (!content) return // 서버 §2.3 가드 선반영: 빈 content는 확정 400이므로 클라이언트에서 차단
    try {
      await updateKnowledge(
        settings.serverUrl,
        projectId,
        id,
        content,
        editCategory === '' ? null : editCategory,
      )
      cancelEdit()
      setRefreshKey((n) => n + 1) // refetch는 useEffect의 가드 경로로(직접 호출 시 stale clobber 위험)
    } catch (err) {
      // 실패 시 편집 폼 유지(재시도 가능) + 사용자 피드백. 무음 unhandled rejection 방지
      toast.error(t('wiki.save_failed'))
      console.error('[WikiPanel] 편집 저장 실패:', err)
    }
  }

  async function confirmDelete(id: number): Promise<void> {
    if (!projectId) return
    try {
      await deleteKnowledge(settings.serverUrl, projectId, id)
      setConfirmingId(null)
      setRefreshKey((n) => n + 1)
    } catch (err) {
      toast.error(t('wiki.delete_failed'))
      console.error('[WikiPanel] 삭제 실패:', err)
    }
  }

  return (
    <div
      data-testid="wiki-panel"
      className="flex flex-shrink-0 flex-col border-l border-border bg-surface overflow-hidden"
      style={{ width: 320 }}
    >
      <div className="border-b border-border px-4 py-2 text-[13px] font-semibold text-fg">
        {t('wiki.title')}
      </div>
      <div className="border-b border-border px-3 py-2 flex flex-col gap-2">
        <input
          data-testid="wiki-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('wiki.search_placeholder')}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-fg-ghost outline-none focus:border-accent transition-colors"
        />
        <select
          data-testid="wiki-source-filter"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent transition-colors"
        >
          <option value="">{t('wiki.all_sources')}</option>
          <option value="plan_task">plan_task</option>
          <option value="design_ui">design_ui</option>
          <option value="develop_code">develop_code</option>
          <option value="security_audit">security_audit</option>
        </select>
        <select
          data-testid="wiki-category-filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent transition-colors"
        >
          <option value="">{t('wiki.all_categories')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-[12px] text-fg-ghost">{t('wiki.empty')}</p>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              data-testid="wiki-item"
              className="rounded border border-border bg-bg px-2.5 py-1.5"
            >
              {editingId === it.id ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    data-testid="wiki-edit-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent transition-colors resize-y"
                  />
                  <select
                    data-testid="wiki-edit-category"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent transition-colors"
                  >
                    <option value="">{t('wiki.category_none')}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <button
                      data-testid="wiki-edit-save"
                      type="button"
                      onClick={() => void saveEdit(it.id)}
                      disabled={!editContent.trim()}
                      className="rounded bg-accent px-2 py-0.5 text-[11px] text-bg hover:opacity-90 disabled:opacity-30 transition-opacity"
                    >
                      {t('wiki.save')}
                    </button>
                    <button
                      data-testid="wiki-edit-cancel"
                      type="button"
                      onClick={cancelEdit}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-fg hover:bg-surface transition-colors"
                    >
                      {t('wiki.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-fg whitespace-pre-wrap break-words">{it.content}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {it.category && (
                      <span
                        data-testid="wiki-item-category"
                        className="inline-block rounded bg-accent/15 px-1.5 py-0.5 text-[9px] text-accent uppercase"
                      >
                        {it.category}
                      </span>
                    )}
                    <span className="inline-block text-[9px] text-fg-ghost uppercase">
                      {t('wiki.source')}: {it.sourceAgent}
                    </span>
                  </div>
                  {confirmingId === it.id ? (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[11px] text-fg-ghost">{t('wiki.delete_confirm')}</span>
                      <button
                        data-testid="wiki-delete-confirm"
                        type="button"
                        onClick={() => void confirmDelete(it.id)}
                        className="rounded bg-danger px-2 py-0.5 text-[11px] text-bg hover:opacity-90 transition-opacity"
                      >
                        {t('wiki.delete')}
                      </button>
                      <button
                        data-testid="wiki-delete-cancel"
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-fg hover:bg-surface transition-colors"
                      >
                        {t('wiki.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        data-testid="wiki-item-edit"
                        type="button"
                        onClick={() => startEdit(it)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-fg hover:bg-surface transition-colors"
                      >
                        {t('wiki.edit')}
                      </button>
                      <button
                        data-testid="wiki-item-delete"
                        type="button"
                        onClick={() => setConfirmingId(it.id)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-fg hover:bg-surface transition-colors"
                      >
                        {t('wiki.delete')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
