import { describe, it, expect } from 'vitest'
import { createDeployProjectHandler } from './deploy-project.js'
import type { DeployGatePort } from './deploy-gate.js'

const allowGate: DeployGatePort = { checkDeploy: async () => ({ allowed: true }) }

describe('deploy_project 릴리스 게이트', () => {
  it('blocked verdict → execute가 게이트에서 throw(GitHub 호출 전·게이트 호출 검증)', async () => {
    let gateCalled = false
    const gate: DeployGatePort = {
      checkDeploy: async (projectId) => {
        gateCalled = true
        expect(projectId).toBe('proj-a') // execute가 userContext.projectId를 게이트에 전달
        return { allowed: false, reason: '게이트 차단 사유 X' }
      },
    }
    const h = createDeployProjectHandler('tok', 'redis://x', gate)
    await expect(
      h.execute(
        { projectPath: '/no/such', owner: 'o', repo: 'r', branch: 'main', commitMessage: 'm' },
        'sess-1',
        { userId: 'u', projectId: 'proj-a', workspaceRoot: '/abs/ws' },
      ),
    ).rejects.toThrow(/게이트 차단 사유 X/)
    expect(gateCalled).toBe(true) // 게이트가 실제로 실행돼 차단했음을 구조적으로 증명
  })

  it('포트 미주입 → 게이트 검사 없음(회귀 0·다른 사유로 실패)', async () => {
    const h = createDeployProjectHandler('tok', 'redis://x') // gate 없음
    // 게이트가 아니라 GitHub/파일 단계에서 실패 — 게이트 throw 메시지가 아님을 확인
    await expect(
      h.execute(
        { projectPath: '/no/such/path/xyz', owner: 'o', repo: 'r', branch: 'main', commitMessage: 'm' },
        'sess-1',
        { userId: 'u', projectId: 'proj-a', workspaceRoot: '/abs/ws' },
      ),
    ).rejects.not.toThrow(/게이트 차단/)
  })

  it('allow verdict → 게이트 통과(이후 GitHub 단계로 진행)', async () => {
    const h = createDeployProjectHandler('tok', 'redis://x', allowGate)
    // 게이트는 통과하고 GitHub 단계(잘못된 토큰)에서 실패 — 게이트 throw가 아님
    await expect(
      h.execute(
        { projectPath: '/no/such', owner: 'o', repo: 'r', branch: 'main', commitMessage: 'm' },
        'sess-1',
        { userId: 'u', projectId: 'proj-a', workspaceRoot: '/abs/ws' },
      ),
    ).rejects.not.toThrow(/게이트 차단/)
  })
})
