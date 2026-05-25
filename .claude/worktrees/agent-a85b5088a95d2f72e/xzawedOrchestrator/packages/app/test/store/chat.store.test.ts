import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../../src/renderer/src/store/chat.store.js'

describe('chat.store', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
  })

  it('starts with null sessionId and empty messages', () => {
    const state = useChatStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
    expect(state.streamingMsgId).toBeNull()
    expect(state.uiSpec).toBeNull()
  })

  it('initSession sets sessionId and resets other state', () => {
    useChatStore.getState().addMessage({
      id: 'msg-1',
      sessionId: 'old-session',
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    })
    useChatStore.getState().initSession('new-session')
    const state = useChatStore.getState()
    expect(state.sessionId).toBe('new-session')
    expect(state.messages).toEqual([])
  })

  it('addMessage appends to messages array', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'msg-1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      timestamp: 1000,
    })
    useChatStore.getState().addMessage({
      id: 'msg-2',
      sessionId: 's1',
      role: 'assistant',
      content: 'hello',
      timestamp: 2000,
    })
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().messages[0].content).toBe('hi')
    expect(useChatStore.getState().messages[1].content).toBe('hello')
  })

  it('startStream sets isStreaming and clears content', () => {
    useChatStore.getState().initSession('s1')
    // Simulate leftover content
    useChatStore.getState().startStream('msg-stream-1')
    useChatStore.getState().appendChunk('some old ')
    // Start a new stream
    useChatStore.getState().startStream('msg-stream-2')
    const state = useChatStore.getState()
    expect(state.isStreaming).toBe(true)
    expect(state.streamingMsgId).toBe('msg-stream-2')
    expect(state.streamingContent).toBe('')
  })

  it('appendChunk accumulates content', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().startStream('msg-a')
    useChatStore.getState().appendChunk('Hello')
    useChatStore.getState().appendChunk(', world')
    useChatStore.getState().appendChunk('!')
    expect(useChatStore.getState().streamingContent).toBe('Hello, world!')
  })

  it('finalizeStream adds assistant message and clears streaming state', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'user-msg',
      sessionId: 's1',
      role: 'user',
      content: 'question',
      timestamp: 1000,
    })
    useChatStore.getState().startStream('assistant-msg')
    useChatStore.getState().appendChunk('The answer is 42.')
    useChatStore.getState().finalizeStream('assistant-msg')

    const state = useChatStore.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
    expect(state.streamingMsgId).toBeNull()
    expect(state.messages).toHaveLength(2)
    const last = state.messages[state.messages.length - 1]
    expect(last.id).toBe('assistant-msg')
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('The answer is 42.')
  })

  it('setUiSpec stores the spec', () => {
    useChatStore.getState().setUiSpec({
      type: 'form',
      title: 'Test Form',
      fields: [{ id: 'name', type: 'text', label: 'Name' }],
      submitAction: 'submit',
    })
    expect(useChatStore.getState().uiSpec).toMatchObject({ type: 'form', title: 'Test Form' })
  })

  it('setUiSpec(null) clears the spec', () => {
    useChatStore.getState().setUiSpec({ type: 'progress_board' })
    useChatStore.getState().setUiSpec(null)
    expect(useChatStore.getState().uiSpec).toBeNull()
  })

  it('reset restores initial state', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      timestamp: 1000,
    })
    useChatStore.getState().startStream('m2')
    useChatStore.getState().appendChunk('streaming...')
    useChatStore.getState().reset()

    const state = useChatStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
  })
})
