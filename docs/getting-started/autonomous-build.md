# 자율 빌드 퀵스타트 — 설명 → 빌드 → 승인 → 완료

> 목표를 자연어로 설명하면 에이전트들이 **계획 → 개발 → 테스트 → 빌드**를 자동 수행하고, 당신은 핵심 결정만 승인한다. 플래그를 하나씩 조립할 필요 없이 **프로필 하나**로 켠다.
>
> 이 경로가 무엇을 켜는지·기본값은 무엇인지는 [Live vs Flagged](../LIVE_VS_FLAGGED.md)를 참고한다.

## 1. 자율 프로필 켜기 (한 스위치)

Manager와 Orchestrator **양쪽**에 같은 값을 설정한다:

```env
PAIS_PROFILE=autonomous
SERVICE_JWT_SECRET=<32자 이상 무작위 문자열>   # 필수 — 없으면 기동 거부
DATABASE_URL=postgres://.../xzawed            # 필수 — 상태·결정 영속
WORKSPACE_ROOT=/absolute/workspace            # build는 절대 워크스페이스 경로 필요
```

`PAIS_PROFILE=autonomous`가 검증된 스택을 켠다:
- 자율 Task Graph(분해 → 디스패치 → 워커) + 실행 검증(WP verify, fail-closed)
- lease 가시성 600s(검증 다단계 중 false reclaim 방지)
- 비용 캡 기본-on(워크플로 $5 / 일 $50 — 필요 시 `MANAGER_BUDGET_*`로 조정)

개별 env가 프로필을 override한다(예: `MANAGER_WP_VERIFY=false`). 자세한 프로필 계약은 [PAIS_PROFILE 설계](../superpowers/specs/2026-07-18-pais-profile-design.md).

> ⚠️ 프로필을 켜지 않으면 앱의 **Build**는 자율 실행 대신 일반 chat(task_request)으로 폴백한다("빌드를 눌렀는데 아무 일도 없음"의 원인).

## 2. 앱에서 요청하기

1. 세션을 열고 만들고 싶은 것을 **자연어로 설명**한다(예: "할 일 목록 REST API를 TypeScript로").
2. 입력창 오른쪽의 **모드 토글을 Build**로 바꾼다(툴팁: *자율 멀티에이전트 빌드*). 기본은 Chat(대화형 질의응답).
3. 전송한다.

Chat과 Build의 차이:
- **Chat** — 대화형 질의응답, 자율 실행 없음(기본).
- **Build** — 목표를 자율 태스크그래프로 분해해 에이전트들이 실행.

## 3. 결정 승인 (Human-in-the-loop)

자율 실행 중 사람 판단이 필요한 지점(결함 브리프·리스크·오라클·릴리스 사인오프 등)은 **C1 결정 대기함**(ActivityBar의 결정 탭)에 카드로 뜬다. 카드의 선택지를 눌러 승인/수정한다. 결정은 비부인으로 영속된다(JWT 신원).

> 어떤 결정 종류가 뜨는지는 활성화한 옵트인 채널에 따라 다르다([Live vs Flagged](../LIVE_VS_FLAGGED.md) 참고). 고급 검증 채널(conformance/impact/property/mutation/security)은 사람이 시드한 오라클/golden이 있어야 의미가 있어 기본 미포함이다.

## 4. 완료

에이전트가 산출물을 만들고 검증이 통과하면 완료된다. 진행·산출물·비용은 앱 우측 패널에서 확인한다.

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| Build를 눌렀는데 일반 답변만 | 자율 프로필 미설정 | 양 서비스에 `PAIS_PROFILE=autonomous` 설정 |
| Manager가 기동 거부 | autonomous인데 JWT/DB 없음 | `SERVICE_JWT_SECRET`(≥32)·`DATABASE_URL` 설정 |
| `Unknown PAIS_PROFILE` | 프로필명 오타 | 현재 지원: `autonomous` |
| WP가 오래 멈춤 | 검증 다단계 > lease 가시성 | 활성 검증 채널에 맞춰 **자동 상향**됨(G8 auto-tune·verify/security 360s·heavy 채널 600s). 더 늘리려면 `MANAGER_LEASE_VISIBILITY_MS` 명시 상향 |
