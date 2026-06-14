import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // esbuild 0.28+ dropped legacy syntax lowering; pin a modern target so the
    // default (chrome87/es2020) lowering path is not taken (GHSA-gv7w-rqvm-qjhr fix).
    target: 'es2022',
  },
})
