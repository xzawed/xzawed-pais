import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.xzawed.launcher',
  productName: 'xzawed Launcher',
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/**/*'],
  extraResources: [{ from: 'resources/docker-compose.prod.yml', to: 'docker-compose.prod.yml' }],
  // **공백을 넣지 마라 — 자동 업데이트가 조용히 404 난다.**
  // `latest.yml` 의 url 은 artifactName 이 아니라 electron-builder 가 파생한
  // `safeArtifactName`(공백 등 URL 비안전 문자를 `-` 로 치환한 것)이다. 기본값
  // `${productName} Setup ${version}.${ext}` 로 두면 디스크에는 `xzawed Launcher Setup
  // 0.1.0.exe` 가 나오는데 `latest.yml` 은 `xzawed-Launcher-Setup-0.1.0.exe` 를 가리키고,
  // 릴리스에 올라가는 것은 전자라 electron-updater 가 없는 자산을 받으러 간다.
  // 이름을 처음부터 안전 문자(`[0-9A-Za-z._-]`)로만 쓰면 electron-builder 가 파생 자체를
  // 하지 않고(`computeSafeArtifactNameIfNeeded` 가 null 을 반환) `latest.yml` 이 디스크 이름을
  // 그대로 쓴다. 그 창이 **구조적으로** 닫히는 것이라 플랫폼별 확인이 필요없다 —
  // mac dmg·linux AppImage/deb 도 같은 규칙을 지난다(deb 의 기본 이름 규칙은 여기 값을 덮지 않는다).
  // 계약은 `test/main/compose-posture.test.ts` 가 고정한다.
  artifactName: 'xzawed-Launcher-${version}-${arch}.${ext}',
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
  linux: { target: [
    { target: 'AppImage', arch: ['x64'] },
    { target: 'deb',      arch: ['x64'] },
  ]},
  // nsis 는 자체 기본 artifactName(`${productName} Setup ...`)을 갖고 있어 위 최상위 값을
  // 상속하지 않는다 — 여기서 다시 안전 이름으로 못 박는다.
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'xzawed-Launcher-Setup-${version}.${ext}',
  },
}

export default config
