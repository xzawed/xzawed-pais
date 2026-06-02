import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { getKnowledge, type KnowledgeItem } from '../lib/api.js'
import { useAppStore } from '../store/app.store.js'

/** 프로젝트에 누적된 도메인 지식을 읽기 전용으로 표시하는 패널(위키 뷰어). */
export function WikiPanel(): React.JSX.Element {
  const { t } = useTranslation('app')
  const { settings } = useAppStore()
  const { projectId } = useParams<{ projectId?: string }>()
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')

  useEffect(() => {
    if (!projectId) {
      setItems([])
      return
    }
    let active = true
    const q = query.trim()
    void getKnowledge(settings.serverUrl, projectId, q || undefined, source || undefined).then((r) => {
      if (active) setItems(r)
    })
    return () => {
      active = false
    }
  }, [projectId, settings.serverUrl, query, source])

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
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-[12px] text-fg-ghost">{t('wiki.empty')}</p>
        ) : (
          items.map((it, i) => (
            <div
              key={i}
              data-testid="wiki-item"
              className="rounded border border-border bg-bg px-2.5 py-1.5"
            >
              <p className="text-[12px] text-fg whitespace-pre-wrap break-words">{it.content}</p>
              <span className="mt-1 inline-block text-[9px] text-fg-ghost uppercase">
                {t('wiki.source')}: {it.sourceAgent}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
