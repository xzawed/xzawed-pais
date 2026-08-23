/**
 * 값을 **POSIX 셸 단어 하나**로 인용한다.
 *
 * `ssh2` 의 `conn.exec(command)` 는 문자열 **하나**를 RFC 4254 §6.5 exec 요청으로 보내고,
 * 원격 sshd 가 그것을 **원격 로그인 셸**에 넘긴다. 그러므로 이스케이프는 원격 셸 문법을
 * 따라야 하며 호스트 셸을 따라서는 안 된다.
 *
 * **`shescape` 를 쓸 수 없는 이유**(전부 실측):
 * - `{ shell: false }` — 아무것도 이스케이프하지 않는다. 6개 페이로드 전부 항등 반환.
 * - `{ shell: true }` — **호스트** 셸 기준이다. Windows 에서 `a && b` → `a ^&^& b`(cmd.exe
 *   문법)를 내면서 정작 POSIX 메타문자인 `;`·`'`·백틱은 그대로 통과시킨다. 방어도 못
 *   하면서 정상 입력만 깨진다.
 * - `{ shell: '/bin/sh' }` — 생성자가 `No executable could be found` 로 **throw** 한다.
 *   shescape 는 호스트에 실재하는 셸 바이너리를 요구하므로 원격 타깃에 쓸 수 없는 도구다.
 *
 * 그래서 `process.platform` 분기가 없는 **순수 문자열 변환**으로 간다 — Windows 로컬 ·
 * Linux CI · Linux 컨테이너가 바이트 동일한 명령을 만든다.
 *
 * POSIX sh 는 작은따옴표 안의 모든 바이트를 리터럴로 다룬다(`; & | $` 백틱 `\` 개행 전부).
 * 유일한 예외인 작은따옴표만 close/escape/reopen 으로 처리하면 된다.
 *
 * **적용 범위: POSIX 원격 셸(sh·bash·zsh·dash·ash).** 원격의 로그인 셸이 cmd.exe 나
 * PowerShell 이면 작은따옴표가 인용 문자가 아니라 이 방어가 성립하지 않는다. 다만 이전
 * 판은 POSIX·비POSIX 양쪽 모두 뚫려 있었으므로 이 변경은 순수 개선이지 새 구멍이 아니다.
 */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
