import { useEffect, useState } from 'react'
import WizardLayout from './components/wizard/WizardLayout.js'
import Dashboard from './components/dashboard/Dashboard.js'
import UpdateModal from './components/UpdateModal.js'
import { useServicesStore } from './stores/services.store.js'
import type { ServiceState } from '@xzawed/launcher-shared'

export default function App(): JSX.Element {
  const [isSetupDone, setIsSetupDone] = useState<boolean | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes: string } | null>(null)
  const setServices = useServicesStore((s) => s.setServices)
  const appendLog = useServicesStore((s) => s.appendLog)

  useEffect(() => {
    void globalThis.launcherAPI?.isSetupComplete().then(setIsSetupDone)

    const unsubServices = globalThis.launcherAPI?.onServicesUpdate((states: ServiceState[]) => setServices(states))
    const unsubLog = globalThis.launcherAPI?.onLogLine((line: string) => appendLog(line))
    const unsubUpdate = globalThis.launcherAPI?.onUpdateAvailable(setUpdateInfo)

    return () => {
      unsubServices?.()
      unsubLog?.()
      unsubUpdate?.()
    }
  }, [setServices, appendLog])

  if (isSetupDone === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[var(--fg-muted)] text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <>
      {isSetupDone ? <Dashboard /> : <WizardLayout onComplete={() => setIsSetupDone(true)} />}
      {updateInfo && <UpdateModal info={updateInfo} onClose={() => setUpdateInfo(null)} />}
    </>
  )
}
