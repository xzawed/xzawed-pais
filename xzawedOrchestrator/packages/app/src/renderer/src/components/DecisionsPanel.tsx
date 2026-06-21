import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@xzawed/ui'
import { getPendingDecisions, submitDecision, type PendingDecision } from '../lib/api.js'
import { useAppStore } from '../store/app.store.js'

/** §4 사람 결정 default choice(context.options 미제공 시 fallback). */
const DEFAULT_CHOICES = ['fix_reverify', 'spec_fix', 'accept_known', 'reject'] as const

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
        if (!signal || signal.active) {
          setItems([])
          setLoading(false)
        }
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
              {d.context?.attribution && (
                <p className="text-[10px] text-fg-ghost">
                  {t('decisions.attribution')}: {d.context.attribution.faultTier}
                  {' '}(impl {d.context.attribution.counters?.impl ?? 0} · task {d.context.attribution.counters?.task ?? 0} · plan {d.context.attribution.counters?.plan ?? 0})
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {(d.context?.options?.length ? d.context.options : DEFAULT_CHOICES).map((choice) => (
                  <button
                    key={choice}
                    data-testid={`decision-submit-${choice}`}
                    type="button"
                    onClick={() => void submit(d.requestId, choice)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface transition-colors"
                  >
                    {t(`decisions.choice_${choice}`, choice)}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-fg-ghost">{t('decisions.choice_hint')}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
