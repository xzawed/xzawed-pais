import { describe, it, expect, vi } from 'vitest'
import { Bulkhead } from '../resilience/bulkhead.js'

/** 다음 macrotask까지 양보(대기 중인 waiter가 깨어날 시간을 준다). */
const tick = () => new Promise((r) => setImmediate(r))

describe('Bulkhead', () => {
  it('캡 미설정이면 acquire는 막지 않는다(무제한)', async () => {
    const b = new Bulkhead({})
    const r1 = await b.acquire('dev')
    const r2 = await b.acquire('dev')
    expect(b.snapshot().perKey['dev']).toBe(2)
    r1()
    r2()
    expect(b.snapshot().global).toBe(0)
  })

  it('perKeyLimit 1이면 같은 키 두 번째 acquire는 release까지 막힌다', async () => {
    const b = new Bulkhead({ perKeyLimit: 1 })
    const r1 = await b.acquire('dev')
    let acquired2 = false
    const p2 = b.acquire('dev').then((rel) => { acquired2 = true; return rel })
    await tick()
    expect(acquired2).toBe(false) // 캡 도달 → 큐잉
    expect(b.snapshot().queued).toBe(1)
    r1() // 해제 → 대기자 깨움
    await p2
    expect(acquired2).toBe(true)
  })

  it('다른 키는 perKey 캡에 막히지 않는다(풀 분리)', async () => {
    const b = new Bulkhead({ perKeyLimit: 1 })
    await b.acquire('dev')
    let acquiredTester = false
    await b.acquire('tester').then(() => { acquiredTester = true })
    expect(acquiredTester).toBe(true) // 다른 키는 통과
  })

  it('globalLimit는 키를 가로질러 동시 실행을 캡한다', async () => {
    const b = new Bulkhead({ globalLimit: 2 })
    await b.acquire('dev')
    await b.acquire('tester')
    let acquired3 = false
    const p3 = b.acquire('builder').then((rel) => { acquired3 = true; return rel })
    await tick()
    expect(acquired3).toBe(false) // 전역 캡 도달
    expect(b.snapshot().global).toBe(2)
  })

  it('HoL 방지 — 키A가 캡에 막혀도 키B 대기자는 먼저 진행한다', async () => {
    const b = new Bulkhead({ perKeyLimit: 1, globalLimit: 10 })
    const rA = await b.acquire('A')      // A=1 (cap)
    let aWoke = false
    let bWoke = false
    b.acquire('A').then(() => { aWoke = true }) // A 큐잉(캡)
    const pB = b.acquire('B').then((rel) => { bWoke = true; return rel }) // B는 가능
    await pB
    expect(bWoke).toBe(true)   // B는 A의 캡과 무관하게 진행(head-of-line 차단 없음)
    expect(aWoke).toBe(false)  // A는 여전히 대기
    rA()
    await tick()
    expect(aWoke).toBe(true)   // A 해제 후 A 대기자 진행
  })

  it('run(key, fn)은 acquire→fn→release를 감싸고 예외 시에도 해제한다', async () => {
    const b = new Bulkhead({ perKeyLimit: 1 })
    await expect(b.run('dev', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(b.snapshot().perKey['dev'] ?? 0).toBe(0) // 예외에도 슬롯 해제
    const ok = await b.run('dev', async () => 42)
    expect(ok).toBe(42)
  })

  it('release는 멱등이다(중복 호출이 카운터를 음수로 만들지 않음)', async () => {
    const b = new Bulkhead({ perKeyLimit: 2 })
    const r = await b.acquire('dev')
    r()
    r() // 중복 — 무시
    expect(b.snapshot().perKey['dev'] ?? 0).toBe(0)
    expect(b.snapshot().global).toBe(0)
  })

  it('전역 해제가 대기자 1개만 깨운다(슬롯 1개당 1 grant)', async () => {
    const b = new Bulkhead({ globalLimit: 1 })
    const r1 = await b.acquire('dev')
    let woke = 0
    b.acquire('a').then(() => { woke++ })
    b.acquire('b').then(() => { woke++ })
    await tick()
    expect(woke).toBe(0)
    r1()
    await tick()
    expect(woke).toBe(1) // 슬롯 1개 → 1명만
  })
})
