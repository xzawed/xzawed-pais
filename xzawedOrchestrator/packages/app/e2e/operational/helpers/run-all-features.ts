import type { Page } from 'playwright'
import type { FeatureResult } from './screenshot-helper.js'
import { ScreenshotHelper } from './screenshot-helper.js'
import { runFeat01AppInit } from '../features/feat-01-app-init.js'
import { runFeat02Auth } from '../features/feat-02-auth.js'
import { runFeat03Project } from '../features/feat-03-project.js'
import { runFeat04Message } from '../features/feat-04-message.js'
import { runFeat05Pipeline } from '../features/feat-05-pipeline.js'
import { runFeat06Github } from '../features/feat-06-github.js'
import { runFeat07Mcp } from '../features/feat-07-mcp.js'
import { runFeat08Plugin } from '../features/feat-08-plugin.js'
import { runFeat09Settings } from '../features/feat-09-settings.js'
import { runFeat10Palette } from '../features/feat-10-palette.js'
import { runFeat11Error } from '../features/feat-11-error.js'

export async function runAllFeatures(
  page: Page,
  ss: ScreenshotHelper,
  opts?: { serverUrl?: string; email?: string; password?: string },
): Promise<FeatureResult[]> {
  const results: FeatureResult[] = []
  results.push(await runFeat01AppInit(page, ss))
  results.push(await runFeat02Auth(page, ss, {
    serverUrl: opts?.serverUrl ?? process.env['SERVER_URL'] ?? 'http://localhost:3000',
    email: opts?.email ?? process.env['TEST_EMAIL'] ?? 'test@example.com',
    password: opts?.password ?? process.env['TEST_PASSWORD'] ?? 'password123',
  }))
  results.push(await runFeat03Project(page, ss))
  results.push(await runFeat04Message(page, ss))
  results.push(await runFeat05Pipeline(page, ss))
  results.push(await runFeat06Github(page, ss))
  results.push(await runFeat07Mcp(page, ss))
  results.push(await runFeat08Plugin(page, ss))
  results.push(await runFeat09Settings(page, ss))
  results.push(await runFeat10Palette(page, ss))
  results.push(await runFeat11Error(page, ss))
  return results
}
