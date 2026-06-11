/**
 * §13 벌크헤드 — 에이전트 종류별 풀 + 전역 캡으로 동시 실행을 제한하는 순수 async 세마포어.
 * 캡 도달 시 **큐잉(드롭 금지·백프레셔)**, FIFO·HoL(head-of-line) 차단 회피(해제 시 진행 가능한 첫 대기자 grant).
 *
 * 한 종류의 에이전트가 폭주해도 다른 종류의 풀을 잠식하지 않게 격리(연쇄 장애 차단, senario §13/§3).
 * I/O·타이머 0 — 호출자가 `acquire`(슬롯 확보까지 await) 후 release, 또는 `run(key, fn)`으로 감싼다.
 */

export interface BulkheadOptions {
  /** 전역 동시 실행 캡. 0/미지정이면 무제한(Infinity). */
  globalLimit?: number
  /** 키(에이전트 종류)별 동시 실행 캡. 0/미지정이면 무제한(Infinity). */
  perKeyLimit?: number
}

export interface BulkheadSnapshot {
  global: number
  perKey: Record<string, number>
  queued: number
}

interface Waiter {
  key: string
  resolve: (release: () => void) => void
}

function limitOf(v: number | undefined): number {
  return v !== undefined && v > 0 ? v : Infinity
}

export class Bulkhead {
  private readonly globalLimit: number
  private readonly perKeyLimit: number
  private globalActive = 0
  private readonly perKeyActive = new Map<string, number>()
  private readonly waiters: Waiter[] = []

  constructor(opts: BulkheadOptions = {}) {
    this.globalLimit = limitOf(opts.globalLimit)
    this.perKeyLimit = limitOf(opts.perKeyLimit)
  }

  private canRun(key: string): boolean {
    return this.globalActive < this.globalLimit && (this.perKeyActive.get(key) ?? 0) < this.perKeyLimit
  }

  /** 슬롯 1개 점유(global + perKey 증가) 후 멱등 release 함수를 만든다. */
  private grant(key: string): () => void {
    this.globalActive++
    this.perKeyActive.set(key, (this.perKeyActive.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return // 멱등 — 중복 release 무시(카운터 음수 방지)
      released = true
      this.globalActive--
      const next = (this.perKeyActive.get(key) ?? 1) - 1
      if (next <= 0) this.perKeyActive.delete(key)
      else this.perKeyActive.set(key, next)
      this.pump()
    }
  }

  /** 해제 후 — 진행 가능한 대기자를 FIFO로 깨운다(HoL 회피: 막힌 키는 건너뛰고 가능한 첫 waiter grant). */
  private pump(): void {
    for (let i = 0; i < this.waiters.length; ) {
      const w = this.waiters[i]!
      if (this.canRun(w.key)) {
        this.waiters.splice(i, 1)
        w.resolve(this.grant(w.key)) // grant가 슬롯을 점유 — 다음 루프의 canRun이 갱신된 카운터를 반영
      } else {
        i++ // 이 대기자는 아직 막힘 — 다음 대기자 검사(head-of-line 차단 회피)
      }
    }
  }

  /** 슬롯을 확보한다. 캡 도달 시 가능해질 때까지 await(큐잉·드롭 없음). 반환=release 함수(멱등). */
  acquire(key: string): Promise<() => void> {
    if (this.canRun(key)) return Promise.resolve(this.grant(key))
    return new Promise<() => void>((resolve) => {
      this.waiters.push({ key, resolve })
    })
  }

  /** acquire→fn→release(finally)를 감싸는 편의. fn이 throw해도 슬롯을 해제한다. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  snapshot(): BulkheadSnapshot {
    return {
      global: this.globalActive,
      perKey: Object.fromEntries(this.perKeyActive),
      queued: this.waiters.length,
    }
  }
}
