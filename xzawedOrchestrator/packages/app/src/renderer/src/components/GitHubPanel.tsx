import React from 'react'
import { useIntegrationsStore } from '../store/integrations.store.js'

export function GitHubPanel(): React.JSX.Element {
  const { setActivePanel } = useIntegrationsStore()
  return (
    <div className="integration-panel">
      <div className="panel-header">
        <button className="panel-back-btn" onClick={() => setActivePanel('chat')}>← 뒤로</button>
        <h2>🐙 GitHub</h2>
      </div>
      <div className="panel-card">준비 중...</div>
    </div>
  )
}
