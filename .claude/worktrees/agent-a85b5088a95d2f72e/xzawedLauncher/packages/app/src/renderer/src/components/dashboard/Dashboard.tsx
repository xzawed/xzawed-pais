import { useState } from 'react'
import ActionBar from './ActionBar.js'
import ServiceRow from './ServiceRow.js'
import LogStream from './LogStream.js'
import SettingsModal from '../SettingsModal.js'
import { useServicesStore } from '../../stores/services.store.js'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'
import type { ServiceName } from '@xzawed/launcher-shared'

const INFRA: readonly ServiceName[] = ['postgres', 'redis']
const AGENTS = SERVICE_NAMES.filter((n) => !INFRA.includes(n))

export default function Dashboard() {
  const services = useServicesStore((s) => s.services)
  const logs = useServicesStore((s) => s.logs)
  const [showSettings, setShowSettings] = useState(false)

  function getService(name: ServiceName) {
    return services.find((s) => s.name === name) ?? { name, status: 'stopped' as const }
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      <ActionBar
        onOpen={() => void globalThis.launcherAPI!.openOrchestrator()}
        onStopAll={() => void globalThis.launcherAPI!.stopAllServices()}
        onRestartAll={() => void globalThis.launcherAPI!.restartAllServices()}
        onSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">인프라</p>
          <div className="grid grid-cols-2 gap-2">
            {INFRA.map((name) => (
              <ServiceRow key={name} service={getService(name)}
                onRestart={() => void globalThis.launcherAPI!.restartService(name)}
                onStop={() => void globalThis.launcherAPI!.stopService(name)} />
            ))}
          </div>
        </section>
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">에이전트 서비스</p>
          <div className="flex flex-col gap-1.5">
            {AGENTS.map((name) => (
              <ServiceRow key={name} service={getService(name)}
                onRestart={() => void globalThis.launcherAPI!.restartService(name)}
                onStop={() => void globalThis.launcherAPI!.stopService(name)} />
            ))}
          </div>
        </section>
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">실시간 로그</p>
          <LogStream logs={logs} />
        </section>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
