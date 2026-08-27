# xzawedPAIS 문서

현재 기준의 문서 인덱스. 각 항목은 **그 주제의 단일 진실원천**을 가리킨다.

문서가 코드의 사실을 복제하면 반드시 어긋나므로, 여기서는 복제 대신 위임한다. 서비스별 구조·함정은 각 서비스의 `CLAUDE.md`가, 계약은 `spec/`이, 플래그 활성 여부는 `LIVE_VS_FLAGGED.md`가 갖는다.

## 먼저 읽을 것

| 문서 | 무엇을 답하나 |
|---|---|
| [운영 — 실행](operations/running.md) | 로컬·Docker·원격에서 어떻게 띄우는가. 설정 계약, 첫 요청, 함정 |
| [Live vs Flagged](LIVE_VS_FLAGGED.md) | 무엇이 기본 실행되고 무엇이 플래그 뒤에 있나. **"✅"는 머지·테스트 완료지 기본 활성이 아니다** |
| [루트 CLAUDE.md](../CLAUDE.md) | 플랫폼 개요, 서비스 표, 저장소 공통 규칙 |

## 경계 계약

서비스 경계를 넘는 계약 중 **단일 타입이 경계를 span하지 못하는 것**만 문서로 갖는다. tsc가 교차검증하지 못하는 지점이라 여기가 정본이다.

| 문서 | 경계 |
|---|---|
| [Redis 스트림 봉투](spec/redis-envelope.md) | 서비스 간 모든 통신. 스트림 키·소비자 그룹 맵과 DLQ 실패 의미론 |
| [에이전트 RPC](spec/agent-rpc.md) | Manager ↔ 에이전트 7종. 도구 7종의 요청·완료 타입 |
| [Electron IPC](spec/electron-ipc.md) | 렌더러 ↔ main. 채널 문자열 20+1개와 선언처 네 곳 |

## 서비스

각 서비스의 명령·아키텍처·함정은 해당 `CLAUDE.md`에 있다. 아래 문서는 역할과 메시지 흐름을 다룬다.

| 서비스 | 포트 | 역할 | CLAUDE.md |
|---|---|---|---|
| [Orchestrator](services/orchestrator.md) | 3000 | 사용자 지시 수신·정제, Manager 전달, Electron 앱 | [→](../xzawedOrchestrator/CLAUDE.md) |
| [Manager](services/manager.md) | 3001 | Claude tool-calling 루프, 에이전트 위임, 자율 아크 | [→](../xzawedManager/CLAUDE.md) |
| [Shared](services/shared.md) | — | `@xzawed/agent-streams` 공통 라이브러리 | [→](../xzawedShared/CLAUDE.md) |
| [Planner](services/planner.md) | 3002 | intent → `Step[]` 분해 | [→](../xzawedPlanner/CLAUDE.md) |
| [Developer](services/developer.md) | 3003 | 코드 생성·수정 | [→](../xzawedDeveloper/CLAUDE.md) |
| [Designer](services/designer.md) | 3004 | UI 컴포넌트 스펙 설계 | [→](../xzawedDesigner/CLAUDE.md) |
| [Tester](services/tester.md) | 3005 | 테스트 실행·분석 | [→](../xzawedTester/CLAUDE.md) |
| [Builder](services/builder.md) | 3006 | 빌드 감지·실행 | [→](../xzawedBuilder/CLAUDE.md) |
| [Watcher](services/watcher.md) | 3007 | 파일 변경 감시 스트리밍 | [→](../xzawedWatcher/CLAUDE.md) |
| [Security](services/security.md) | 3008 | OWASP 보안 감사 | [→](../xzawedSecurity/CLAUDE.md) |
| [Launcher](services/launcher.md) | — | 비개발자 설치·실행 런처 | [→](../xzawedLauncher/CLAUDE.md) |

## 개발

| 문서 | 설명 |
|---|---|
| [기여 가이드](development/contributing.md) | 개발 환경, 브랜치 전략, 커밋 컨벤션, PR 기준 |
| [코딩 컨벤션](development/conventions.md) | 전 서비스 공통 패턴 |
| [불변식 M1~M9·N1~N8](development/invariants.md) | 코드 주석이 `M8`·`N6` 라벨로 가리키는 것들의 **정본 정의** + 각각이 실제로 강제되는 지점 |
| [보안 패턴](development/security-patterns.md) | 명령 실행·경로 검증·인증·IPC 구현 패턴 |
| [테스트 패턴](development/testing-patterns.md) | 블로킹 I/O mock, E2E Electron 제약, shard coverage |
| [SonarCloud](development/sonarcloud.md) | CPD·커버리지·핫스팟 트러블슈팅 |
| [번역 기여](development/translation-guide.md) | 번역 파일 구조, 키 추가, 새 언어 추가 |
| [ADR](development/adr/README.md) | Architecture Decision Records |
| [설계 스펙](superpowers/specs/) | 슬라이스별 설계 스펙 |
| [로드맵](development/roadmap.md) | 구현 현황 |
