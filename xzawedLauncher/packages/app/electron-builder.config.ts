import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.xzawed.launcher',
  productName: 'xzawed Launcher',
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/**/*'],
  extraResources: [{ from: 'resources/docker-compose.prod.yml', to: 'docker-compose.prod.yml' }],
  publish: {
    provider: 'github',
    owner: 'xzawed',
    repo: 'xzawed-pais',
    releaseType: 'release',
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  mac: { target: [{ target: 'dmg', arch: ['x64', 'arm64'] }], notarize: false },
  linux: { target: [{ target: 'AppImage', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
}

export default config
