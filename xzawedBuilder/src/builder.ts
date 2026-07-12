import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detectBuildInfo } from './detector.js'
import { exec, validatePath } from './executor.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import type { ManagerToBuilderMessage, BuilderToManagerMessage } from './types.js'
import type { Config } from './config.js'
import { resolveWorkspaceRoot, createCollaborativeHandler } from '@xzawed/agent-streams'

export { resolveWorkspaceRoot }

type BuilderPayload = ManagerToBuilderMessage['payload']

// 빌드 명령 allowlist는 의도적으로 관용적이다 — 사용자 자기 프로젝트를 다양한 툴체인으로
// 빌드해야 하므로 npx/npm/pnpm/yarn 등이 임의 하위명령을 받아야 한다("빌드=임의 코드 실행"은
// 빌드 에이전트의 본질적 기능). **진짜 방어는 executor.ts의 spawn(shell:false)**(셸 미경유 →
// 메타문자·체이닝 무효)이며, 아래 allowlist + 메타문자 차단은 defense-in-depth다. 프리픽스를
// 좁히면 legit 빌드(npx vite build·npm run build 등)를 깨므로 축소하지 않는다.
const ALLOWED_PREFIXES = [
  'pnpm', 'npm', 'npx', 'yarn',
  'cargo build', 'make build', 'cmake',
  'gradle', 'mvn', 'go build',
  'tsc', 'webpack', 'vite build',
]

function validateBuildCommand(cmd: string): void {
  const normalized = cmd.trim()
  const isAllowed = ALLOWED_PREFIXES.some(
    prefix => normalized === prefix || normalized.startsWith(prefix + ' ')
  )
  if (!isAllowed) {
    throw new Error(`Build command not allowed: ${normalized}`)
  }
  // 셸 메타문자 + 개행 차단(defense-in-depth). spawn(shell:false)이라 실제로는 무해하나,
  // trim은 내부 개행을 남기므로 `npm run build\n<임의명령>` 류 주입 시도를 조기 거부한다.
  if (/[;&|`$><\n\r]/.test(normalized)) {
    throw new Error(`Shell metacharacters are not permitted in build command`)
  }
}

export class Builder {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config
  ) {}

  async handle(message: ManagerToBuilderMessage): Promise<void> {
    await createCollaborativeHandler<BuilderToManagerMessage, BuilderPayload>({
      publish: (sid, m) => this.producer.publish(sid, m),
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      completeType: 'build_complete',
      runMain: async (payload, base) => {
        const sessionId = base.sessionId
        const { projectPath, command } = payload
        const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)
        const validatedPath = await validatePath(projectPath, workspaceRoot)

        let buildCmd: string
        let buildRoot: string
        if (command) {
          validateBuildCommand(command)
          buildCmd = command
          buildRoot = validatedPath
        } else {
          const detected = await detectBuildInfo(validatedPath, workspaceRoot)
          buildCmd = detected.command
          buildRoot = await validatePath(detected.buildRoot, workspaceRoot)
        }

        await this.stripPackageManagerField(buildRoot)
        await validatePath(buildRoot, workspaceRoot)
        await this.runPreInstall(buildRoot, sessionId)

        const { success, output, duration } = await exec(
          buildCmd,
          buildRoot,
          async (chunk) => {
            await this.producer.publish(sessionId, this.makeProgress(sessionId, chunk))
          },
          this.config.buildTimeoutMs,
        )

        const errors = success ? [] : await this.runner.analyzeBuildFailure(output)
        const artifacts = success ? [buildRoot] : []
        const knowledge = await this.runner.extractKnowledge(output)

        return {
          publishResult: () => this.producer.publish(sessionId, {
            ...base,
            type: 'build_complete',
            payload: {
              success,
              output,
              duration,
              errors,
              artifacts,
              ...(knowledge.length > 0 ? { knowledge } : {}),
              content: success ? '빌드 완료' : `빌드 실패: ${errors.length}개 오류`,
            },
          }),
        }
      },
    })(message)
  }

  private async stripPackageManagerField(buildRoot: string): Promise<void> {
    const pkgPath = path.join(buildRoot, 'package.json')
    try {
      const content = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as Record<string, unknown>
      if ('packageManager' in pkg) {
        delete pkg.packageManager
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xzawed-builder-'))
        const tmpPath = path.join(tmpDir, 'package.json')
        try {
          await fs.writeFile(tmpPath, JSON.stringify(pkg, null, 2), 'utf-8')
          await fs.rename(tmpPath, pkgPath)
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true })
        }
      }
    } catch {
      // package.json 없거나 파싱 불가: 무시
    }
  }

  private async runPreInstall(buildRoot: string, sessionId: string): Promise<void> {
    const hasPkg = await fs.access(path.join(buildRoot, 'package.json')).then(() => true).catch(() => false)
    if (!hasPkg) return

    const hasModules = await fs.access(path.join(buildRoot, 'node_modules')).then(() => true).catch(() => false)
    if (hasModules) return

    const hasPnpmLock = await fs.access(path.join(buildRoot, 'pnpm-lock.yaml')).then(() => true).catch(() => false)
    const installCmd = hasPnpmLock
      ? 'pnpm install --frozen-lockfile --ignore-scripts'
      : 'npm ci --ignore-scripts'

    const installResult = await exec(
      installCmd,
      buildRoot,
      async (chunk) => {
        await this.producer.publish(sessionId, this.makeProgress(sessionId, chunk))
      },
      this.config.buildTimeoutMs,
    )
    if (!installResult.success) {
      throw new Error(`의존성 설치 실패 (exit ${installResult.exitCode})`)
    }
  }

  private makeProgress(sessionId: string, content: string): BuilderToManagerMessage {
    return {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'build_progress',
      payload: { content },
    }
  }
}
