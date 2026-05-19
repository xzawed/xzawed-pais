import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepWelcome(): JSX.Element {
  const setStep = useWizardStore((s) => s.setStep)
  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="text-6xl">🤖</div>
      <h1 className="text-2xl font-bold text-[var(--fg)]">xzawed에 오신 것을 환영합니다</h1>
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        AI 멀티 에이전트가 여러분의 지시를 실제 소프트웨어로 만들어드립니다.<br />
        지금부터 5단계로 환경을 설정합니다.
      </p>
      <button
        onClick={() => setStep('docker')}
        className="mt-4 rounded-lg bg-[var(--accent)] px-8 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors"
      >
        시작하기 →
      </button>
    </div>
  )
}
