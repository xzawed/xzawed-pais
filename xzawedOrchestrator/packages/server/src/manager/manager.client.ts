export class ManagerClient {
  constructor(private baseUrl: string) {}

  async startSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/sessions/${sessionId}/start`
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      throw new Error(`Manager returned ${res.status} for session ${sessionId}`)
    }
  }
}
