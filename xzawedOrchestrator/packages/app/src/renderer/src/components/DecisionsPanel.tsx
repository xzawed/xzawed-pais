import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@xzawed/ui'
import { getPendingDecisions, submitDecision, type PendingDecision } from '../lib/api.js'
import { useAppStore } from '../store/app.store.js'

/** §4 사람 결정 choice. fix_reverify만 즉시 폐루프(PR-A), 나머지는 기록만(후속 동작 없음). */
const CHOICES = [
  { value: 'fix_reverify', live: true },
  { value: 'spec_fix', live: false },
  { value: 'accept_known', live: false },
  { value: 'reject', live: false },
] as const

/** 프로젝트의 pending 사람 결정(결함 브리프)을 표시하고 PO가 choice를 제출하는 패널. */
export function DecisionsPanel(): React.JSX.Element {
  const { t } = useTranslation('app')
  const { settings } = useAppStore()
  const accessToken = useAuthStore((s) => s.accessToken)
  const { projectId } = useParams<{ projectId?: string }>()
  const [items, setItems] = useState<PendingDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchDecisions = useCallback(
    (signal?: { active: boolean }): Promise<void> => {
      if (!projectId) {
        setItems([])
        return Promise.resolve()
      }
      setLoading(true)
      return getPendingDecisions(settings.serverUrl, projectId)
        .then((r) => {
          if (!signal || signal.active) setItems(r)
        })
        .finally(() => {
          if (!signal || signal.active) setLoading(false)
        })
    },
    [projectId, settings.serverUrl, refreshKey],
  )

  useEffect(() => {
    const signal = { active: true }
    void fetchDecisions(signal)
    return () => { signal.active = false }
  }, [fetchDecisions])

  async function submit(requestId: string, choice: string): Promise<void> {
    if (!projectId) return
    try {
      await submitDecision(settings.serverUrl, projectId, requestId, choice, undefined, accessToken ?? undefined)
      toast.success(t('decisions.submitted'))
      setRefreshKey((n) => n + 1) // refetch는 useEffect 가드 경로로
    } catch (err) {
      toast.error(t('decisions.submit_failed'))
      console.error('[DecisionsPanel] 결정 제출 실패:', err)
    }
  }

  return (
    <div
      data-testid="decisions-panel"
      className="flex flex-shrink-0 flex-col border-l border-border bg-surface overflow-hidden"
      style={{ width: 360 }}
    >
      <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg">{t('decisions.title')}</span>
        <button
          data-testid="decisions-refresh"
          type="button"
          onClick={() => setRefreshKey((n) => n + 1)}
          className="rounded border border-border px-2 py-0.5 text-[10px] text-fg-muted hover:bg-surface-raised transition-colors"
        >
          {t('decisions.refresh')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <p data-testid="decisions-empty" className="text-[12px] text-fg-ghost">
            {loading ? t('decisions.loading') : t('decisions.empty')}
          </p>
        ) : (
          items.map((d) => (
            <div key={d.requestId} data-testid="decisions-item" className="rounded border border-border bg-bg px-2.5 py-2 flex flex-col gap-1.5">
              {d.context?.location && (
                <p className="text-[12px] font-medium text-fg">
                  <span className="text-fg-ghost">{t('decisions.location')}: </span>{d.context.location}
                </p>
              )}
              {d.context?.expectedVsActual && (
                <p className="text-[11px] text-fg whitespace-pre-wrap break-words">
                  <span className="text-fg-ghost">{t('decisions.expected_vs_actual')}: </span>{d.context.expectedVsActual}
                </p>
              )}
              {d.context?.impact && d.context.impact.length > 0 && (
                <p className="text-[11px] text-fg-muted">
                  <span className="text-fg-ghost">{t('decisions.impact')}: </span>{d.context.impact.join(' · ')}
                </p>
              )}
              {d.context?.evidenceRefs && d.context.evidenceRefs.length > 0 && (
                <p className="text-[10px] text-fg-ghost break-all">
                  {t('decisions.evidence')}: {d.context.evidenceRefs.join(', ')}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {CHOICES.map((c) => (
                  <button
                    key={c.value}
                    data-testid={`decision-submit-${c.value}`}
                    type="button"
                    onClick={() => void submit(d.requestId, c.value)}
                    title={c.live ? undefined : t('decisions.choice_noop_hint')}
                    className={c.live
                      ? 'rounded bg-accent px-2 py-0.5 text-[11px] text-bg hover:opacity-90 transition-opacity'
                      : 'rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface transition-colors'}
                  >
                    {t(`decisions.choice_${c.value}`)}
                  </button>
                ))}
              </div>
              {/* 정직 라벨: fix_reverify만 즉시 재구동, 나머지는 기록만(후속 동작 없음) */}
              <p className="text-[9px] text-fg-ghost">{t('decisions.choice_noop_hint')}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
