import type { Page } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

export interface FeatureResult {
  featureId: string
  featureName: string
  status: 'pass' | 'fail' | 'warn'
  steps: StepResult[]
  durationMs: number
}

export interface StepResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  screenshotPath?: string
  error?: string
}

export class ScreenshotHelper {
  private readonly baseDir: string

  constructor(roundDir: string) {
    this.baseDir = roundDir
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  async take(page: Page, featureDir: string, name: string): Promise<string> {
    const dir = path.join(this.baseDir, 'screenshots', featureDir)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${name}.png`)
    await page.screenshot({ path: filePath, fullPage: false })
    return filePath
  }
}
