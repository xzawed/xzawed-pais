import type { Redis } from 'ioredis'

/** 발행 옵션. maxlen: approximate MAXLEN(~) 상한(무한 증가 방지, watcher 관례). */
export interface PublishOptions {
  maxlen?: number
}

/** 전송 계층 추상화(발행). */
export interface EventBus {
  /** message를 JSON 직렬화해 stream에 발행(xadd). xadd 결과(엔트리 ID, 비정상 시 null)를 그대로 반환. */
  publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null>
}

/** xreadgroup의 ioredis raw 응답(스트림 → [id, fields[]] 목록). null은 타임아웃. */
export type RawStreamReply = [string, [string, string[]][]][]

/** 소비 전송 포트(P1c-2). EventBus(publish)를 상속 — DLQ 발행에 publish 재사용. */
export interface StreamConsumerPort extends EventBus {
  /** xgroup CREATE(MKSTREAM). BUSYGROUP은 무시, 그 외 오류는 전파. */
  ensureGroup(stream: string, group: string): Promise<void>
  /** xreadgroup '>'(신규 메시지). raw 응답 또는 null(타임아웃). */
  readGroup(stream: string, group: string, consumer: string, opts: { count: number; blockMs: number }): Promise<RawStreamReply | null>
  /** xack — pipeline 배치(미지원 시 개별 폴백). */
  ack(stream: string, group: string, ids: string[]): Promise<void>
  /** xautoclaim — 미처리(idle) 메시지 재획득. ioredis raw 응답([cursor, messages, deleted]). */
  autoclaim(stream: string, group: string, consumer: string, opts: { minIdleMs: number; count: number }): Promise<unknown>
}

/** ioredis 기반 EventBus + 소비 전송 포트 구현. 전송 전용(직렬화/스트림 명령 외 로직 없음). */
export class RedisEventBus implements StreamConsumerPort {
  constructor(private readonly redis: Redis) {}

  async publish(stream: string, message: unknown, opts?: PublishOptions): Promise<string | null> {
    const data = JSON.stringify(message)
    return opts?.maxlen !== undefined
      ? this.redis.xadd(stream, 'MAXLEN', '~', String(opts.maxlen), '*', 'data', data)
      : this.redis.xadd(stream, '*', 'data', data)
  }

  async ensureGroup(stream: string, group: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }
  }

  async readGroup(
    stream: string, group: string, consumer: string, opts: { count: number; blockMs: number },
  ): Promise<RawStreamReply | null> {
    return this.redis.xreadgroup(
      'GROUP', group, consumer,
      'COUNT', String(opts.count), 'BLOCK', String(opts.blockMs),
      'STREAMS', stream, '>',
    ) as unknown as Promise<RawStreamReply | null>
  }

  async ack(stream: string, group: string, ids: string[]): Promise<void> {
    if (typeof this.redis.pipeline === 'function') {
      const pipeline = this.redis.pipeline()
      for (const id of ids) pipeline.xack(stream, group, id)
      await pipeline.exec()
      return
    }
    for (const id of ids) await this.redis.xack(stream, group, id)
  }

  async autoclaim(
    stream: string, group: string, consumer: string, opts: { minIdleMs: number; count: number },
  ): Promise<unknown> {
    return this.redis.xautoclaim(stream, group, consumer, opts.minIdleMs, '0-0', 'COUNT', String(opts.count))
  }
}
