// jscpd:ignore-start
// cpd-exempt: Launcher·Orchestrator는 별개의 Electron 앱이고 각자 자기 빌드 설정을 갖는다.
// electron-vite의 표준 3-타깃(main·preload·renderer) 형태라 초기값이 같을 뿐이며,
// 두 앱이 독립적으로 갈라지는 것이 정상이다 — 동일성을 강제하지 않는다(replicated-block 아님).
// 빌드 도구 설정은 제품 코드가 아니므로 CPD 대상에서 뺀다.
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      // esbuild 0.28+ dropped legacy syntax lowering; pin a modern target so the
      // default (chrome87/es2020) lowering path is not taken (GHSA-gv7w-rqvm-qjhr fix).
      target: 'es2022',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
// jscpd:ignore-end
