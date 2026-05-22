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
  // NOTE: notarize is disabled here because it requires an Apple Developer certificate and
  // notarytool credentials configured in the CI environment. To enable in production CI:
  //   1. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID env vars
  //   2. Change notarize to: { teamId: process.env.APPLE_TEAM_ID }
  // Until enabled, macOS Gatekeeper will show an "unverified developer" warning.
  // electron-updater verifies update packages via SHA-512 checksum by default;
  // do NOT set autoUpdater.verifyUpdateCodeSignature = false anywhere.
  mac: { target: [{ target: 'dmg', arch: ['x64', 'arm64'] }], notarize: false },
  linux: { target: [{ target: 'AppImage', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
}

export default config
