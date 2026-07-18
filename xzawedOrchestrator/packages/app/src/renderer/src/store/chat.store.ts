import { create } from 'zustand'
import type { Message, UISpec } from '@xzawed/shared'

/** 사용자 입력 대기 요청. approval이 있으면 승인 게이트(승인/수정/중단), 없으면 명확화(자유 텍스트). */
export interface PendingInfoRequest {
  agentId: string
  prompt: string
  approval?: { stage: string; summary: string; mode: 'manual' }
}

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
  /** G5 고객 비용 가시성: 현재 세션 누적 비용(USD·Manager costOf 추정). RightPanel 표시. */
  sessionCostUsd: number
  elapsedMs: number
  modifiedFiles: string[]
  pendingInfoRequest: PendingInfoRequest | null
  /** 위키 지식 변경 신호(WS knowledge_changed). projectId·단조 증가 seq로 WikiPanel이 즉시 새로고침을 판단. */
  knowledgeChange: { projectId: string; seq: number } | null
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
  setSessionCostUsd: (usd: number) => void
  setElapsedMs: (ms: number) => void
  addModifiedFile: (path: string) => void
  setPendingInfoRequest: (req: PendingInfoRequest | null) => void
  notifyKnowledgeChange: (projectId: string) => void
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
  sessionCostUsd: 0,
  elapsedMs: 0,
  modifiedFiles: [] as string[],
  pendingInfoRequest: null as PendingInfoRequest | null,
  knowledgeChange: null as { projectId: string; seq: number } | null,
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

  setSessionCostUsd: (sessionCostUsd) => set({ sessionCostUsd }),

  setElapsedMs: (elapsedMs) => set({ elapsedMs }),

  addModifiedFile: (path) =>
    set((state) => ({
      modifiedFiles: state.modifiedFiles.includes(path)
        ? state.modifiedFiles
        : [...state.modifiedFiles, path],
    })),

  setPendingInfoRequest: (req) => set({ pendingInfoRequest: req }),

  // seq를 단조 증가시켜 동일 projectId 연속 변경도 새 참조로 구독자(WikiPanel useEffect)를 깨운다.
  notifyKnowledgeChange: (projectId) =>
    set((state) => ({ knowledgeChange: { projectId, seq: (state.knowledgeChange?.seq ?? 0) + 1 } })),

  reset: () => set({ ...initialState }),
}))
