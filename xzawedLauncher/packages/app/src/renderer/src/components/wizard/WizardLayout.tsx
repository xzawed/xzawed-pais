import { useWizardStore } from '../../stores/wizard.store.js'
import StepWelcome from './StepWelcome.js'
import StepDocker from './StepDocker.js'
import StepClaude from './StepClaude.js'
import StepServices from './StepServices.js'
import StepComplete from './StepComplete.js'
import type { WizardStep } from '@xzawed/launcher-shared'

const STEPS: WizardStep[] = ['welcome', 'docker', 'claude', 'services', 'complete']
const STEP_LABELS = ['환영', 'Docker', 'Claude', '서비스 기동', '완료']

interface Props { onComplete: () => void }

export default function WizardLayout({ onComplete }: Readonly<Props>): JSX.Element {
  const step = useWizardStore((s) => s.step)
  const idx = STEPS.indexOf(step)

  const StepComponent = {
    welcome: StepWelcome,
    docker: StepDocker,
    claude: StepClaude,
    services: StepServices,
    complete: () => <StepComplete onComplete={onComplete} />,
  }[step]

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[var(--bg)] p-6">
      <div className="flex items-center gap-2 mb-10">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              i < idx ? 'bg-[var(--accent)] text-white' :
              i === idx ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]/40' :
              'bg-[var(--surface-raised)] text-[var(--fg-muted)]'
            }`}>
              {i < idx ? '✓' : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 transition-colors ${i < idx ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        ))}
      </div>
      <div className="w-full max-w-md">
        <StepComponent />
      </div>
      <div className="mt-4 text-xs text-[var(--fg-muted)]">{STEP_LABELS[idx]}</div>
    </div>
  )
}
