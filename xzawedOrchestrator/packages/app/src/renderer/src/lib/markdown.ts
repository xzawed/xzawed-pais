import { createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
      langs: [
        'typescript', 'javascript', 'tsx', 'jsx',
        'python', 'bash', 'json', 'yaml', 'markdown',
        'css', 'html', 'sql', 'go', 'rust',
      ],
    })
  }
  return highlighterPromise
}

export function detectLang(filename?: string): string {
  if (!filename) return 'typescript'
  const ext = filename.split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', css: 'css', html: 'html', sql: 'sql',
    go: 'go', rs: 'rust',
  }
  return map[ext] ?? 'typescript'
}
