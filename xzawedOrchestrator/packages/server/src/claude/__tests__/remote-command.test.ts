import { describe, it, expect } from 'vitest'
import { buildRemoteCommand } from '../ssh-remote-runner.js'
import { posixQuote } from '../posix-shell-quote.js'

/**
 * **원격 명령 조립 계약 — 셸 주입 방어.**
 *
 * `ssh2` 의 `conn.exec(command)` 는 문자열 **하나**를 RFC 4254 §6.5 exec 요청으로 보내고,
 * 원격 sshd 가 그것을 **원격 로그인 셸**에 넘긴다. 따라서 이스케이프는 원격 셸 문법을
 * 따라야 하는데, 이전 판은 `new Shescape({ shell: false })` 를 썼다.
 *
 * 그 모드는 **아무것도 이스케이프하지 않는다**(실측: 6개 페이로드 전부 항등 반환).
 * `shell: true` 로 바꾸는 것도 답이 아니다 — 호스트 셸 기준이라 Windows 에서
 * `a && b` → `a ^&^& b`(cmd.exe 문법)를 내면서 정작 POSIX 메타문자인 `;`·`'`·백틱은
 * 그대로 통과시킨다. `shell: '/bin/sh'` 는 생성자가 throw 한다(호스트에 그 바이너리가
 * 없으므로) — 모듈 스코프 생성이라 **서버 기동 자체가 죽는다.**
 *
 * **테스트가 셸을 spawn 하지 않는다.** POSIX 단어 분해를 순수 문자열로 모사한 oracle 을
 * 쓴다. 셸을 띄우면 Windows 로컬에서 조건부 skip 이 생겨 "로컬 그린이 CI 그린이 아닌"
 * 상태가 된다 — 이 저장소가 반복해 데인 함정이다.
 */

/**
 * POSIX sh 의 단어 분해를 모사한다. **인용 구간 밖에 셸 메타문자가 하나라도 남으면
 * throw** 하므로, 단순히 "단어 수가 맞다"가 아니라 "주입 조건 자체가 성립하지 않는다"를
 * 단언하게 된다.
 */
function splitPosixWords(command: string): string[] {
  const words: string[] = []
  let cur = ''
  let started = false
  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    if (ch === "'") {
      started = true
      i++
      while (i < command.length && command[i] !== "'") { cur += command[i]; i++ }
      if (i >= command.length) throw new Error(`인용이 닫히지 않았다: ${command}`)
      i++
      continue
    }
    if (ch === '\\') {
      started = true
      i++
      if (i >= command.length) throw new Error(`역슬래시로 끝났다: ${command}`)
      cur += command[i]
      i++
      continue
    }
    if (ch === ' ') {
      if (started) { words.push(cur); cur = ''; started = false }
      i++
      continue
    }
    if (/[;&|<>$`(){}[\\]*?!#~\\n"]/.test(ch)) {
      throw new Error(`인용 밖 셸 메타문자 ${JSON.stringify(ch)}: ${command}`)
    }
    started = true
    cur += ch
    i++
  }
  if (started) words.push(cur)
  return words
}

const BASE = ['claude', '--print', '--output-format', 'stream-json', '--verbose', '--']

const PAYLOADS: [string, string][] = [
  ['평문', 'summarize this file'],
  ['세미콜론', 'a; echo nope'],
  ['명령치환', 'a $(echo nope) b'],
  ['백틱', 'a `echo nope` b'],
  ['AND/OR', 'a && echo nope || echo nope'],
  ['파이프', 'a | echo nope'],
  ['내장 작은따옴표', "it's a test"],
  ['변수 확장', 'a $HOME ${PATH} b'],
  ['개행', 'line1\\necho nope'],
  ['리다이렉션', 'a > /dev/null < /dev/null'],
  ['역슬래시', 'C:\\\\path\\\\to\\\\file'],
  ['비ASCII', '한글 "따옴표" é 🚀'],
  // 프롬프트가 CLI 플래그처럼 생긴 경우. `--` 가 실제로 하는 일이 이것이다 —
  // **셸 주입 방어가 아니다**(셸이 먼저 파싱을 끝낸다).
  ['선행 대시', '--output-format=evil'],
]

describe('buildRemoteCommand — 주입 페이로드가 단어 하나로 남는다', () => {
  it.each(PAYLOADS)('%s', (_label, payload) => {
    expect(splitPosixWords(buildRemoteCommand(payload))).toEqual([...BASE, payload])
  })
})

describe('buildRemoteCommand — 골든 문자열', () => {
  it('양성 입력의 정확한 바이트를 못 박는다', () => {
    // 이전 판은 이 정상 입력조차 `-- hello world` 로 내보내 원격에서 argv 2개로
    // 쪼개졌다. 즉 보안 이전에 **기능 결함**이기도 했다.
    expect(buildRemoteCommand('hello world')).toBe(
      "claude --print --output-format stream-json --verbose -- 'hello world'",
    )
  })

  it('내장 작은따옴표는 close/escape/reopen 형태다', () => {
    // POSIX 인용에서 유일하게 까다로운 지점. 여기만 틀리면 인용이 조기 종료되어
    // 방어 전체가 무너진다.
    expect(buildRemoteCommand("it's")).toBe(
      "claude --print --output-format stream-json --verbose -- 'it'\\''s'",
    )
  })
})

describe('buildRemoteCommand — `--` 앞 인자도 인용한다', () => {
  it('claudeSessionId 와 systemPrompt 도 단어 하나로 남는다', () => {
    // 프로덕션 경로는 현재 `RunOptions = {}` 라 이 둘이 비어 있지만 인터페이스는 셋 다
    // 허용한다. 그리고 이 둘은 `--` **앞**에 놓이므로 나중에 외부 입력이 흘러들면
    // `--` 방어조차 못 받는다 — 루트 CLAUDE.md 가 cli-runner 에 대해 이미 경고한 함정이다.
    const command = buildRemoteCommand('safe prompt', {
      claudeSessionId: 's; echo nope',
      systemPrompt: 'p && echo nope',
    })
    expect(splitPosixWords(command)).toEqual([
      'claude', '--resume', 's; echo nope',
      '--print', '--output-format', 'stream-json', '--verbose',
      '--system-prompt', 'p && echo nope',
      '--', 'safe prompt',
    ])
  })
})

describe('posixQuote', () => {
  it('빈 문자열도 단어 하나가 된다', () => {
    // 인용하지 않으면 빈 메시지가 argv 에서 통째로 사라진다.
    expect(posixQuote('')).toBe("''")
    expect(splitPosixWords(buildRemoteCommand(''))).toEqual([...BASE, ''])
  })

  it('호스트 플랫폼에 의존하지 않는다 — 순수 문자열 변환이다', () => {
    // 같은 입력이 Windows 로컬·Linux CI·컨테이너에서 바이트 동일해야 한다.
    expect(posixQuote('a b')).toBe("'a b'")
    expect(posixQuote("a'b")).toBe("'a'\\''b'")
  })
})
