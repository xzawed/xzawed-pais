import { InMemorySessionStore } from '../sessions/session.store.js'
import { startMcpStdio } from './server.js'

const store = new InMemorySessionStore()
await startMcpStdio(store)
