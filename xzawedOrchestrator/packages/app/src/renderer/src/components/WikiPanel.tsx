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

  useEffect(() => {
    if (!projectId) {
      setItems([])
      return
    }
    let active = true
    void getKnowledge(settings.serverUrl, projectId).then((r) => {
      if (active) setItems(r)
    })
    return () => {
      active = false
    }
  }, [projectId, settings.serverUrl])

  return (
    <div
      data-testid="wiki-panel"
      className="flex flex-shrink-0 flex-col border-l border-border bg-surface overflow-hidden"
      style={{ width: 320 }}
    >
      <div className="border-b border-border px-4 py-2 text-[13px] font-semibold text-fg">
        {t('wiki.title')}
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
