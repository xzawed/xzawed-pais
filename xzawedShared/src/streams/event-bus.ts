import type { Redis } from 'ioredis'

/** 발행 옵션. maxlen: approximate MAXLEN(~) 상한(무한 증가 방지, watcher 관례). */
export interface PublishOptions {
  maxlen?: number
}

/** 전송 계층 추상화(발행). 소비(subscribe/consume)는 후속 슬라이스에서 확장. */
export interface EventBus {
  /** message를 JSON 직렬화해 stream에 발행(xadd). xadd 결과(엔트리 ID, 비정상 시 null)를 그대로 반환. */
  publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null>
}

/** ioredis xadd 기반 EventBus 구현. 전송 전용(직렬화+xadd 외 로직 없음). */
export class RedisEventBus implements EventBus {
  constructor(private readonly redis: Redis) {}

  async publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null> {
    const data = JSON.stringify(message)
    return opts?.maxlen !== undefined
      ? this.redis.xadd(stream, 'MAXLEN', '~', String(opts.maxlen), '*', 'data', data)
      : this.redis.xadd(stream, '*', 'data', data)
  }
}
