import { create } from 'zustand'
import type { WizardStep, DockerInstallStatus, ClaudeDetectStatus } from '@xzawed/launcher-shared'

interface WizardState {
  step: WizardStep
  dockerStatus: DockerInstallStatus
  claudeStatus: ClaudeDetectStatus
  claudeEmail: string | null
  isLoading: boolean
  error: string | null
  setStep: (step: WizardStep) => void
  setDockerStatus: (s: DockerInstallStatus) => void
  setClaudeStatus: (s: ClaudeDetectStatus) => void
  setClaudeEmail: (email: string | null) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 'welcome',
  dockerStatus: 'checking',
  claudeStatus: 'checking',
  claudeEmail: null,
  isLoading: false,
  error: null,
  setStep: (step) => set({ step }),
  setDockerStatus: (dockerStatus) => set({ dockerStatus }),
  setClaudeStatus: (claudeStatus) => set({ claudeStatus }),
  setClaudeEmail: (claudeEmail) => set({ claudeEmail }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
