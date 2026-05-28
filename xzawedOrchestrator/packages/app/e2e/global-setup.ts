import { existsSync } from 'node:fs'
import path from 'node:path'

export default async function globalSetup(): Promise<void> {
  const mainEntry = path.resolve(__dirname, '../out/main/index.js')
  if (!existsSync(mainEntry)) {
    throw new Error(
      '\n❌ Electron 빌드 결과물이 없습니다. 먼저 다음을 실행하세요:\n' +
      '   pnpm build\n' +
      `   (찾는 경로: ${mainEntry})\n`
    )
  }
}
