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
  /** 다중 스트림 xreadgroup(fan-in). ids는 streams와 1:1(길이 불일치는 throw). raw 응답 또는 null. */
  readGroupMulti(streams: string[], group: string, consumer: string, ids: string[], opts: { count: number; blockMs: number }): Promise<RawStreamReply | null>
  /** xack — pipeline 배치(미지원 시 개별 폴백). */
  ack(stream: string, group: string, ids: string[]): Promise<void>
  /** xautoclaim — 미처리(idle) 메시지 재획득. ioredis raw 응답([cursor, messages, deleted]). */
  autoclaim(stream: string, group: string, consumer: string, opts: { minIdleMs: number; count: number }): Promise<unknown>
}

/** 요청-응답(RPC) 전송 포트. 그룹 소비와 직교(비그룹 xread + tip 상관). publish(요청 xadd)는 EventBus 상속. */
export interface RequestReplyPort extends EventBus {
  /** 응답 스트림 최신 엔트리 ID(xrevrange COUNT 1). 비었으면 '0-0'. publish 전 캡처용. */
  streamTip(stream: string): Promise<string>
  /** 비그룹 xread BLOCK(fromId 이후). raw 응답 또는 null(타임아웃). */
  readFrom(stream: string, fromId: string, opts: { count: number; blockMs: number }): Promise<RawStreamReply | null>
}

/** ioredis 기반 EventBus + 소비 전송 포트 + 요청-응답 포트 구현. 전송 전용(직렬화/스트림 명령 외 로직 없음). */
export class RedisEventBus implements StreamConsumerPort, RequestReplyPort {
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

  async readGroupMulti(
    streams: string[], group: string, consumer: string, ids: string[], opts: { count: number; blockMs: number },
  ): Promise<RawStreamReply | null> {
    if (streams.length !== ids.length) {
      throw new Error('readGroupMulti: streams/ids length mismatch')
    }
    return this.redis.xreadgroup(
      'GROUP', group, consumer,
      'COUNT', String(opts.count), 'BLOCK', String(opts.blockMs),
      'STREAMS', ...streams, ...ids,
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

  async streamTip(stream: string): Promise<string> {
    const tip = await this.redis.xrevrange(stream, '+', '-', 'COUNT', '1') as [string, string[]][]
    return tip[0]?.[0] ?? '0-0'
  }

  async readFrom(
    stream: string, fromId: string, opts: { count: number; blockMs: number },
  ): Promise<RawStreamReply | null> {
    return this.redis.xread(
      'COUNT', String(opts.count), 'BLOCK', String(opts.blockMs),
      'STREAMS', stream, fromId,
    ) as unknown as RawStreamReply | null
  }
}
