interface Props { onComplete: () => void }

export default function StepComplete({ onComplete }: Readonly<Props>): JSX.Element {
  async function handleOpen(): Promise<void> {
    await globalThis.launcherAPI!.saveSetupConfig({
      claudeMode: 'cli',
      completedAt: new Date().toISOString(),
    }).catch(() => {})
    await globalThis.launcherAPI!.openOrchestrator()
    await globalThis.launcherAPI!.minimizeToTray()
    onComplete()
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="text-6xl">🎉</div>
      <h2 className="text-2xl font-bold">모든 준비가 완료되었습니다!</h2>
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        11개 서비스가 모두 실행 중입니다.<br />
        런처는 백그라운드에서 계속 실행됩니다.
      </p>
      <button
        onClick={() => void handleOpen()}
        className="rounded-xl bg-green-500 px-8 py-3 text-sm font-bold text-white hover:bg-green-600 transition-colors"
      >
        🎯 xzawed 열기
      </button>
      <p className="text-xs text-[var(--fg-muted)]">런처는 시스템 트레이에서 계속 실행됩니다</p>
    </div>
  )
}
