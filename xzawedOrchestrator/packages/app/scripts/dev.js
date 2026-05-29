'use strict'
// ELECTRON_RUN_AS_NODE=1 causes Electron to run in Node.js mode,
// which breaks require("electron") in the main process.
// This wrapper clears it before launching electron-vite dev.
const { spawnSync } = require('child_process')
const env = { ...process.env }
delete env['ELECTRON_RUN_AS_NODE']
const result = spawnSync('electron-vite', ['dev'], {
  stdio: 'inherit',
  env,
  shell: true,
  cwd: __dirname.replace(/[\\/]scripts$/, ''),
})
process.exit(result.status ?? 0)
