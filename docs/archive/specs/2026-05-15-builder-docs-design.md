# xzawedBuilder 기본 문서 세트 설계

날짜: 2026-05-15  
범위: Claude-first 실용형 문서 세트 (방식 A)  
주요 독자: Claude Code

## 결정 사항

- **독자:** Claude Code가 새 세션에서 읽고 즉시 구현 가능한 수준
- **톤:** 서술 최소화, 코드 블록 + 명시적 경로 + 결정 가능한 구조
- **CHANGELOG.md:** 구현 전 단계이므로 생략. 첫 릴리즈 시 추가
- **스펙 파일:** `xzawedBuilder-spec.md` → `docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md`로 이동

## 생성할 파일

### README.md
- 시스템 내 위치 (한 줄)
- 전제조건 체크리스트 (Node 20+, pnpm, Redis, ANTHROPIC_API_KEY)
- 셋업 순서: `pnpm install` → `cp .env.example .env` → `.env` 편집 → `pnpm dev`
- 핵심 명령어 표
- 관련 서비스 포트 표

### .env.example
- 모든 환경변수 포함
- 각 변수에 허용값 범위 주석
- 필수/선택 구분 명시

### .gitignore
- Node.js / TypeScript 표준 항목
- 프로젝트별 추가: `dist/`, `*.env`, `build-output/`

### CONTRIBUTING.md
- 파일별 단일 책임 원칙 (executor는 실행만, detector는 감지만)
- 에러 처리 규칙: `BuildError` 타입 사용, 원시 Error 직접 발행 금지
- Redis 메시지 발행 규칙: 반드시 Zod 검증 후 발행
- 스트리밍 출력 규칙: 청크 단위 `build_progress` 발행 방식
- 테스트 작성 기준: executor/detector는 단위 테스트, streams는 통합 테스트

### docs/architecture.md
- 컴포넌트 인터페이스 계약 (각 모듈의 입력/출력 타입)
- 빌드 명령 감지 결정 트리 (package.json → Cargo.toml → Makefile 순서)
- 에러 처리 흐름 (빌드 실패 → Claude 분석 → BuildError[] 생성)
- 보안 경계: WORKSPACE_ROOT 경로 검증 로직
- 세션 생명주기: consumer group ACK 처리 방식

### docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md
- 기존 `xzawedBuilder-spec.md` 내용 이동 + 섹션 구조 정제
