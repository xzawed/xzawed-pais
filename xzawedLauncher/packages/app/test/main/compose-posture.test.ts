import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

/**
 * **출하 compose 태세 계약.**
 *
 * 이 파일은 저장소에 **사본 두 벌**로 존재한다 — 저장소 루트와 이 패키지의
 * `resources/`. 패키징 대상은 후자다. 한쪽만 고치면 Launcher 는 그대로 깨진 채
 * 남으므로 두 벌을 여기서 함께 검사한다.
 *
 * 이 스택은 **사용자 PC에서 Launcher 가 띄우는 로컬 스택**이다(서버 배포용 compose 는
 * 저장소에 없다). 그래서 태세의 기준선은 "인증을 걸었는가"가 아니라
 * **"이 기계 밖에서 닿는가"**다. 이전 판은 앱 서비스 9개를 전부
 * `ports: ["3000:3000"]` 형태로 열어 두었고, 그 표기는 `0.0.0.0` 바인딩이라
 * 같은 LAN 의 아무나 무인증 오케스트레이터에 닿을 수 있었다.
 */

const ROOT = path.resolve(__dirname, '../../../../..')

const COPIES = {
  '저장소 루트': path.join(ROOT, 'docker-compose.prod.yml'),
  'Launcher resources': path.join(ROOT, 'xzawedLauncher/packages/app/resources/docker-compose.prod.yml'),
} as const

interface ComposeService {
  ports?: string[]
  environment?: Record<string, string>
  healthcheck?: { test?: unknown }
  secrets?: string[]
  deploy?: { resources?: { limits?: Record<string, string> } }
}
interface Compose {
  services: Record<string, ComposeService>
  secrets?: Record<string, { environment?: string; file?: string }>
}

/** 인프라(postgres·redis)를 뺀 앱 서비스. 태세 규칙은 이쪽에만 적용된다. */
const INFRA = new Set(['postgres', 'redis'])

function load(p: string): Compose {
  return parse(fs.readFileSync(p, 'utf-8')) as Compose
}

function appServices(c: Compose): [string, ComposeService][] {
  return Object.entries(c.services).filter(([name]) => !INFRA.has(name))
}

describe.each(Object.entries(COPIES))('%s — 출하 compose 태세', (_label, file) => {
  const compose = load(file)

  it('앱 서비스 9종이 모두 있다', () => {
    expect(appServices(compose).map(([n]) => n).sort()).toEqual([
      'builder', 'designer', 'developer', 'manager',
      'orchestrator', 'planner', 'security', 'tester', 'watcher',
    ])
  })

  it('호스트 포트를 노출하는 앱 서비스는 orchestrator 하나뿐이다', () => {
    // 나머지는 compose 네트워크 안에서 서비스명으로 서로 부른다.
    // orchestrator 는 `MANAGER_URL: http://manager:3001` 로 매니저를 부르고,
    // 에이전트는 Redis 로만 닿는다 — 호스트 포트가 필요한 것이 하나도 없었다.
    const exposed = appServices(compose).filter(([, s]) => (s.ports?.length ?? 0) > 0).map(([n]) => n)
    expect(exposed).toEqual(['orchestrator'])
  })

  it('orchestrator 는 루프백에만 바인딩한다', () => {
    // `"3000:3000"` 은 0.0.0.0 바인딩이다. 같은 LAN 의 아무나 닿는다.
    const ports = compose.services['orchestrator']?.ports ?? []
    expect(ports).toEqual(['127.0.0.1:3000:3000'])
  })

  it('API 키가 환경변수로 컨테이너에 들어가지 않는다', () => {
    // env 로 넣으면 `docker inspect` 의 Config.Env 에 평문으로 남는다.
    // compose secrets 는 tmpfs 파일로 마운트하므로 그 표면이 사라진다.
    for (const [name, svc] of appServices(compose)) {
      expect(svc.environment?.['ANTHROPIC_API_KEY'], `${name}`).toBeUndefined()
    }
  })

  it('Claude 를 쓰는 서비스는 secrets 로 키를 받는다', () => {
    // Watcher 는 Claude API 를 쓰지 않아 대상이 아니다.
    for (const [name, svc] of appServices(compose)) {
      if (name === 'watcher') {
        expect(svc.secrets ?? [], 'watcher 는 키가 필요없다').toEqual([])
        continue
      }
      expect(svc.secrets, `${name}`).toContain('anthropic_api_key')
      expect(svc.environment?.['ANTHROPIC_API_KEY_FILE'], `${name}`).toBe('/run/secrets/anthropic_api_key')
    }
  })

  it('secret 소스는 호스트 파일이 아니라 compose 프로세스 env 다', () => {
    // `file:` 로 하면 Launcher 가 복호화한 키를 **디스크에 평문으로 써야 한다** —
    // 지금은 userData 의 `api-key.enc` 에 safeStorage 로 봉인돼 있으므로 그것은 후퇴다.
    // `environment:` 소스는 Launcher 가 이미 하고 있는 env 전달을 그대로 쓴다.
    expect(compose.secrets?.['anthropic_api_key']).toEqual({ environment: 'ANTHROPIC_API_KEY' })
    expect(compose.secrets?.['anthropic_api_key']?.file).toBeUndefined()
  })

  it('앱 서비스 9종 모두 healthcheck 를 갖는다', () => {
    // `restart: unless-stopped` 만 있고 healthcheck 가 없으면 크래시 루프가
    // "up" 으로 보인다. Launcher 의 상태 표시가 `docker compose ps` 라 더욱 그렇다.
    for (const [name, svc] of appServices(compose)) {
      expect(svc.healthcheck?.test, `${name}`).toBeDefined()
    }
  })

  it('healthcheck 는 /health 가 아니라 /health/ready 를 친다', () => {
    // `/health` 는 정적 200 이라(liveness) 의존이 죽어도 healthy 를 보고한다.
    // 그 신호로 Launcher 가 `running` 을 판정하고 마법사가 완료를 판정하므로,
    // 기능적으로 죽은 스택이 '완료'로 통과했다. 실검사는 /health/ready 가 한다.
    for (const [name, svc] of appServices(compose)) {
      const test = JSON.stringify(svc.healthcheck?.test ?? [])
      expect(test, `${name}`).toContain('/health/ready')
    }
  })

  it('앱 서비스 9종 모두 메모리 상한을 갖는다', () => {
    // 사용자 PC에서 도는 스택이다. 한 서비스의 누수가 기계를 통째로 잡아먹으면 안 된다.
    for (const [name, svc] of appServices(compose)) {
      expect(svc.deploy?.resources?.limits?.['memory'], `${name}`).toBeDefined()
    }
  })
})

describe('두 사본의 드리프트', () => {
  it('CLAUDE_MODE 기본값 한 줄만 다르다', () => {
    // 사본이 갈라지면 Launcher 만 깨진 채 남는다. 알려진 차이 하나를 고정한다.
    const [a, b] = Object.values(COPIES).map((p) => fs.readFileSync(p, 'utf-8').split(/\r?\n/))
    const diff = a!.map((line, i) => [line, b![i]] as const).filter(([x, y]) => x !== y)
    expect(diff).toEqual([['      CLAUDE_MODE: ${CLAUDE_MODE:-api}', '      CLAUDE_MODE: ${CLAUDE_MODE:-cli}']])
  })
})

/**
 * **패키징 계약 — compose 가 실제로 앱 안에 들어가는가.**
 *
 * 위 검사들은 두 사본이 같은지만 본다. 그것으로는 부족하다는 것이 실측으로 드러났다:
 * 설정 파일이 `electron-builder.config.ts` 라는 이름이었는데 electron-builder 는 그 이름을
 * **자동 탐색하지 않고**(탐색 대상은 `electron-builder.{yml,yaml,json,json5,toml,js,cjs,ts}`),
 * 릴리스 워크플로 3개 잡이 전부 `--config` 없이 부른다. 그래서 설정이 통째로 무시됐고
 * `extraResources` 도 적용되지 않아 **출하된 앱의 `resources/` 에 compose 가 아예 없었다**.
 * `docker-manager.ts` 는 `process.resourcesPath` 기준으로 그 파일을 여니, 사용자에게 나간
 * 런처는 스택을 띄울 수 없었다. 빌드는 성공하므로 아무도 몰랐다.
 *
 * 이름이 탐색되는지는 `scripts/check-compose-parity.js` 가 본다(파일명이라 정확히 판정된다).
 * **내용은 여기서 본다** — 여기서만 설정 객체를 그대로 import 할 수 있기 때문이다.
 */
describe('electron-builder 패키징 계약', () => {
  it('extraResources 가 compose 를 resources 루트에 그 이름으로 넣는다', async () => {
    const { default: config } = await import('../../electron-builder')
    const entries = config.extraResources
    expect(Array.isArray(entries), 'extraResources 가 배열이어야 판정할 수 있다').toBe(true)

    // 도착지 기준으로 본다 — 런타임이 여는 것은 `to` 쪽이다. `to` 생략 시 `from` 의 basename.
    const destinations = (entries as Array<string | { from?: string; to?: string }>).map((e) => {
      if (typeof e === 'string') return path.basename(e)
      const to = e.to
      if (to === undefined || to === '.') return path.basename(e.from ?? '')
      return to
    })

    // 하위 디렉토리로 넣으면 resourcesPath 루트에서 못 찾는다 — basename 비교로는 그것을 놓친다.
    expect(destinations).toContain('docker-compose.prod.yml')
  })

  it('artifactName 이 URL 안전 문자만 낸다 — 아니면 자동 업데이트가 404 난다', async () => {
    const { default: config } = await import('../../electron-builder')

    // `latest.yml` 의 url 은 electron-builder 가 파생한 safeArtifactName 이다(공백 등을 `-` 로
    // 치환한 것). 디스크 이름에 공백이 있으면 둘이 갈라지고, 릴리스에 올라가는 것은 디스크
    // 이름이라 electron-updater 가 없는 자산을 받으러 간다. 패턴 단계에서 막는다.
    const GITHUB_SAFE = /^[0-9A-Za-z._-]*$/
    // 확장 결과가 안전 문자만 내는 매크로. `productName` 은 공백을 담으므로 여기 없다.
    const SAFE_MACROS = ['version', 'arch', 'ext', 'os', 'channel', 'platform']

    const patterns: Array<[string, string | undefined]> = [
      ['artifactName', config.artifactName],
      ['nsis.artifactName', config.nsis?.artifactName],
    ]

    for (const [label, pattern] of patterns) {
      expect(pattern, `${label} 이 설정돼 있어야 한다 — 기본값은 productName 의 공백을 그대로 쓴다`).toBeDefined()
      const macros = [...pattern!.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]!)
      for (const m of macros) {
        expect(SAFE_MACROS, `${label} 의 \${${m}} 는 안전 문자를 보장하지 않는다`).toContain(m)
      }
      expect(pattern!.replace(/\$\{[^}]+\}/g, ''), `${label} 의 리터럴 부분`).toMatch(GITHUB_SAFE)
    }

    // `${version}` 은 안전 매크로지만 semver 빌드 메타데이터(`1.0.0+build`)는 `+` 를 낸다.
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'xzawedLauncher/packages/app/package.json'), 'utf-8'))
    expect(version, '버전 문자열 자체가 URL 안전해야 한다').toMatch(GITHUB_SAFE)
  })
})

describe('electron-builder 리눅스 실행 파일 이름', () => {
  it('linux.executableName 이 리눅스가 받아주는 문자만 쓴다', async () => {
    const { default: config } = await import('../../electron-builder')

    // 리눅스만 실행 파일 이름을 productName 이 아니라 executableName 에서 가져온다
    // (`platformPackager.js:317` 의 `this instanceof LinuxPackager` 분기). 설정하지 않으면
    // 패키지 name 인 `@xzawed/launcher-app` 에서 파생돼 `@` 가 남고, AppImage 빌드가
    // 거부한다 — Windows·macOS 는 productFilename 을 쓰므로 초록이다. 실제로 CI 에서
    // windows 는 통과하고 linux 만 이 이유로 죽었다.
    const name = config.linux?.executableName
    expect(name, 'linux.executableName 이 설정돼 있어야 한다 — 기본값은 패키지 name 에서 파생된다').toBeDefined()
    // electron-builder 의 문구: "only letters, digits, hyphens, underscores, dots, and spaces"
    expect(name!, 'linux.executableName').toMatch(/^[A-Za-z0-9._\- ]+$/)
  })
})
