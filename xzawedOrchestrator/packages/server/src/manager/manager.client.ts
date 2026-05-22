function validateManagerUrl(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Manager URL must use http or https scheme: ${url}`)
  }
}

export class ManagerClient {
  constructor(private readonly baseUrl: string) {
    validateManagerUrl(baseUrl)
  }

  async startSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/sessions/${sessionId}/start`
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      throw new Error(`Manager returned ${res.status} for session ${sessionId}`)
    }
  }
}
