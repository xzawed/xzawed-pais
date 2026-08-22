import { spawn } from 'node:child_process'

/**
 * 자식 프로세스를 실행하고 stdout+stderr를 모아 반환한다.
 *
 * `shell: false`는 이 저장소의 보안 불변식이다 — 인자를 셸에 넘기지 않으므로
 * 메타문자 주입이 성립하지 않는다. 이 파일에서 바꾸면 두 호출부가 함께 뚫린다.
 *
 * 실패 시 종료 코드와 **수집한 출력을 함께** 던진다. 출력이 없으면 "exit 1"만
 * 남아 무엇이 왜 실패했는지 알 수 없다(사본 둘 중 하나가 그랬다).
 */
export function spawnAsync(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const proc = spawn(bin, args, { shell: false })
    proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
    proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))
    proc.on('close', (code: number) => {
      if (code === 0) resolve(chunks.join(''))
      else reject(new Error(`exit ${code}: ${chunks.join('')}`))
    })
    proc.on('error', reject)
  })
}
