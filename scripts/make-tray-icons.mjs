#!/usr/bin/env node
/**
 * Launcher 트레이 아이콘 3종을 생성한다.
 *
 * **바이너리를 손으로 넣지 않고 스크립트로 만든다.** 정체를 알 수 없는 PNG 가 저장소에
 * 들어오면 나중에 아무도 색을 바꾸지 못한다. 의존성 없이 zlib 만으로 PNG 를 조립한다.
 *
 * 왜 필요한가: `tray-manager.ts` 가 `process.resourcesPath` 기준으로 `tray-{ok,warn,error}.png`
 * 를 읽는데 그 파일들이 저장소에도 패키지에도 없었다. `nativeImage.createFromPath` 는 없는
 * 경로에 대해 **throw 하지 않고 빈 이미지를 준다** — 그래서 try/catch 가 아무것도 잡지 못하고
 * 트레이 아이콘이 조용히 비어 있었다. 창을 닫으면 `hide()` 되고 되살리는 유일한 경로가
 * 트레이라, 빈 아이콘은 사용자가 앱을 되찾지 못한다는 뜻이다.
 *
 *   node scripts/make-tray-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 32
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'xzawedLauncher', 'packages', 'app', 'resources')

/** 상태색 — 트레이 아이콘이 전달해야 하는 유일한 정보다. */
const COLORS = {
  ok:    [ 34, 197,  94], // green
  warn:  [245, 158,  11], // amber
  error: [239,  68,  68], // red
}

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return (buf) => {
    let c = -1
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body))
  return Buffer.concat([len, body, crc])
}

/** 가운데 채운 원. 안티에일리어싱은 커버리지 근사로 준다(아이콘이 32px 이라 충분하다). */
function rgba(r, g, b) {
  const rows = []
  const c = (SIZE - 1) / 2
  const radius = SIZE / 2 - 2
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4) // filter byte + RGBA
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c)
      const cov = Math.max(0, Math.min(1, radius + 0.5 - d))
      const o = 1 + x * 4
      row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = Math.round(cov * 255)
    }
    rows.push(row)
  }
  return Buffer.concat(rows)
}

function png(r, g, b) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rgba(r, g, b), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const [status, [r, g, b]] of Object.entries(COLORS)) {
  const file = path.join(OUT, `tray-${status}.png`)
  writeFileSync(file, png(r, g, b))
  console.log(`✓ ${path.relative(process.cwd(), file)}`)
}
