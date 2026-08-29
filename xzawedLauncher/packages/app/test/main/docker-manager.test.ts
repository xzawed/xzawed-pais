import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSpawnResult } from './_helpers.js'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getAppPath: vi.fn(() => '/app') },
}))

let dm: typeof import('../../src/main/docker-manager.js')

beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  dm = await import('../../src/main/docker-manager.js')
})

describe('DockerManager', () => {
  it('checkDocker returns running when docker info output includes Server', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('Server: Docker Engine'))
    const status = await dm.checkDocker()
    expect(status).toBe('running')
  })

  it('checkDocker returns not-installed when both docker info and docker --version fail', async () => {
    spawnMock.mockImplementation(function () { return makeSpawnResult('', 1) })
    const status = await dm.checkDocker()
    expect(status).toBe('not-installed')
  })

  it('validateServiceName throws for unknown service', () => {
    expect(() => dm.validateServiceName('evil; rm -rf /')).toThrow('Invalid service name')
  })

  it('validateServiceName returns name for valid service', () => {
    expect(dm.validateServiceName('redis')).toBe('redis')
  })
})

/**
 * **`docker compose ps --format json` 의 실제 출력으로 고정한다.**
 *
 * 아래 두 행은 손으로 지어낸 것이 아니라 11개 컨테이너가 전부 `healthy` 인 실제 스택에서
 * 그대로 받아 적은 것이다(코드가 읽는 4개 필드만 남겼다). 그 사실이 이 테스트의 전부다 —
 * 옛 코드는 `Name` 에 `^xzawed[_-]` 를 걸어 서비스 이름을 얻으려 했는데, `Name` 은
 * `<project>-<service>-<index>` 이고 project 는 compose 파일이 있는 **디렉토리**에서 온다
 * (패키징된 앱은 `resources`, 저장소는 `xzawedpais`). 그 정규식은 `xzawed` 뒤에 `_`·`-` 를
 * 요구하므로 **어느 경우에도 매치되지 않았다.**
 *
 * 결과는 조용했다: 스택이 완전히 healthy 여도 모든 카드가 `stopped` 으로 남고,
 * 마법사의 완료 조건 `states.every(s => s.status === 'running')` 이 영영 참이 되지 않는다.
 * 지어낸 mock 으로는 이것을 잡을 수 없었다 — 그 mock 이 `Name` 을 `xzawed-builder-1` 로
 * 썼다면 옛 코드가 통과했을 것이다.
 */
const REAL_COMPOSE_PS_ROWS = [
  { Name: 'pais-verify-builder-1',  Service: 'builder',  State: 'running', Health: 'healthy' },
  { Name: 'pais-verify-designer-1', Service: 'designer', State: 'running', Health: 'healthy' },
]

describe('getServiceStatuses — 실제 compose 출력', () => {
  it('project 접두사가 붙은 실제 행에서 서비스 이름을 얻는다', async () => {
    spawnMock.mockReturnValue(makeSpawnResult(REAL_COMPOSE_PS_ROWS.map((r) => JSON.stringify(r)).join('\n')))
    const states = await dm.getServiceStatuses()
    expect(states.map((s) => s.name)).toEqual(['builder', 'designer'])
  })

  it('전부 healthy 인 스택을 running 으로 읽는다 — 마법사 완료 조건이 성립해야 한다', async () => {
    spawnMock.mockReturnValue(makeSpawnResult(REAL_COMPOSE_PS_ROWS.map((r) => JSON.stringify(r)).join('\n')))
    const states = await dm.getServiceStatuses()
    expect(states.every((s) => s.status === 'running')).toBe(true)
  })

  it('알려진 서비스에 포트가 붙는다 — 이름이 어긋나면 undefined 가 된다', async () => {
    spawnMock.mockReturnValue(makeSpawnResult(REAL_COMPOSE_PS_ROWS.map((r) => JSON.stringify(r)).join('\n')))
    const states = await dm.getServiceStatuses()
    expect(states.find((s) => s.name === 'builder')?.port).toBe(3006)
  })
})
