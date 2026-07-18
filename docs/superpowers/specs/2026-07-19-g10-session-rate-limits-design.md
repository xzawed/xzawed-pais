# G10 — sessions 비용 write 엔드포인트 rate-limit 설계

- 상태: 구현 완료
- 날짜: 2026-07-19
- 관련: Tier-1 G10(joint verification 로드맵 §3·W14)
- 선행: auth rate-limit(기존·`@fastify/rate-limit`)

## 문제 (W14)

`sessions.route.ts`의 write 엔드포인트에 rate-limit이 없다. 특히 `POST /sessions/:id/messages`는 LLM 호출 또는 `decompose_request`(자율 태스크그래프)를 트리거하므로, 스팸 시 **비용 폭발·DoS**가 된다 — 프리미엄 비용 통제의 직접 관심사. `auth.route.ts`는 이미 `@fastify/rate-limit`로 보호돼 있다.

## 접근

`@fastify/rate-limit`를 `sessionsRoutes` 플러그인 스코프에 등록(`global: false`)하고, 비용 write 라우트에 per-route `config.rateLimit`를 부여한다. auth와 동일한 429 응답 형태를 공유 헬퍼 `registerLocalRateLimit(app)`로 단일출처화(CPD0).

- **범위·값**(분당·IP 키잉):
  - `POST /sessions` → 10/min (세션 생성)
  - `POST /sessions/:id/messages` → 30/min (LLM/decompose 비용 벡터)
  - `POST /sessions/:id/ui-actions` → 60/min (승인·저렴)
  - GET(읽기) → 무제한
- **IP 키잉**(기본): rate-limit는 `onRequest` 훅으로 auth `preHandler`보다 **먼저** 실행돼 `req.authUser`가 아직 없으므로 per-user 키잉은 불가. IP 키잉이 DoS/비용 보호에 충분하며 auth 라우트와 일관.

## 구조

- **`api/rate-limit.ts` (신규)**: `registerLocalRateLimit(app)` — `global:false` + 429 errorResponseBuilder를 auth·sessions가 공유(내가 도입한 near-clone 제거·CPD0). 각 `register` 스코프는 독립 인스턴스라 두 모듈에서 각각 호출해도 충돌 없음.
- **`api/sessions.route.ts`**: `registerLocalRateLimit(app)` 호출 + `withLimit(max)` 헬퍼(`routeOpts` 스프레드 + `config.rateLimit`)를 세 write 라우트에 적용.
- **`api/auth.route.ts`**: 인라인 등록을 `registerLocalRateLimit(app)`로 치환(동작 불변·리팩터).

## 검증

- `session-rate-limit.test.ts`(신규): 각 라우트가 상한+1회째 429(`error:'Too Many Requests'`) 반환. 각 `it`가 fresh 서버(fresh store) + invalid input(400 fast·Redis/Manager 무접촉)로 hermetic. 상한 이내 요청은 429 아님을 단언(경계 정확).
- auth-rate-limit.test.ts: 리팩터 후에도 통과(동작 불변).

## 범위 밖 (YAGNI)

- per-user(JWT sub) 키잉 — onRequest/preHandler 순서상 불가(IP로 충분).
- GET 엔드포인트 rate-limit — 읽기는 저비용.
- 분산 rate-limit 스토어(Redis 백엔드) — 단일 인스턴스 인메모리로 충분(멀티 인스턴스 SaaS는 Tier-2 소관).
