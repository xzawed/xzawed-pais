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
