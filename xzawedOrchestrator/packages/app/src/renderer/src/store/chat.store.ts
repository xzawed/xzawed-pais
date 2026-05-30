import { create } from 'zustand'
import type { Message, UISpec } from '@xzawed/shared'

interface ChatState {
  sessionId: string | null
  messages: Message[]
  streamingContent: string
  streamingMsgId: string | null
  isStreaming: boolean
  isPending: boolean
  uiSpec: UISpec | null
  logLines: string[]
  tokenCount: number
  elapsedMs: number
  modifiedFiles: string[]
  pendingInfoRequest: { agentId: string; prompt: string } | null
  initSession: (sessionId: string) => void
  addMessage: (msg: Message) => void
  setPending: (v: boolean) => void
  startStream: (msgId: string) => void
  appendChunk: (content: string) => void
  finalizeStream: (msgId: string) => void
  cancelStream: () => void
  setUiSpec: (spec: UISpec | null) => void
  addLogLine: (line: string) => void
  setTokenCount: (n: number) => void
  setElapsedMs: (ms: number) => void
  addModifiedFile: (path: string) => void
  setPendingInfoRequest: (req: { agentId: string; prompt: string } | null) => void
  reset: () => void
}

const initialState = {
  sessionId: null,
  messages: [] as Message[],
  streamingContent: '',
  streamingMsgId: null,
  isStreaming: false,
  isPending: false,
  uiSpec: null,
  logLines: [] as string[],
  tokenCount: 0,
  elapsedMs: 0,
  modifiedFiles: [] as string[],
  pendingInfoRequest: null as { agentId: string; prompt: string } | null,
}

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  initSession: (sessionId) => set({ ...initialState, sessionId }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setPending: (isPending) => set({ isPending }),

  startStream: (msgId) =>
    set({ streamingMsgId: msgId, streamingContent: '', isStreaming: true, isPending: false }),

  appendChunk: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),

  cancelStream: () =>
    set({ isStreaming: false, isPending: false, streamingMsgId: null, streamingContent: '' }),

  finalizeStream: (msgId) =>
    set((state) => {
      if (state.streamingMsgId !== msgId) return state
      const assistantMsg: Message = {
        id: msgId,
        sessionId: state.sessionId ?? '',
        role: 'assistant',
        content: state.streamingContent,
        timestamp: Date.now(),
      }
      return {
        messages: [...state.messages, assistantMsg],
        streamingContent: '',
        streamingMsgId: null,
        isStreaming: false,
      }
    }),

  setUiSpec: (uiSpec) => set({ uiSpec }),

  addLogLine: (line) =>
    set((state) => ({ logLines: [...state.logLines.slice(-199), line] })),

  setTokenCount: (tokenCount) => set({ tokenCount }),

  setElapsedMs: (elapsedMs) => set({ elapsedMs }),

  addModifiedFile: (path) =>
    set((state) => ({
      modifiedFiles: state.modifiedFiles.includes(path)
        ? state.modifiedFiles
        : [...state.modifiedFiles, path],
    })),

  setPendingInfoRequest: (req) => set({ pendingInfoRequest: req }),

  reset: () => set({ ...initialState }),
}))
