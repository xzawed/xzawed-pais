-- 001_init.sql: schema_migrations 테이블은 pool.ts의 runMigrationsFromDir()가
-- CREATE TABLE IF NOT EXISTS로 자동 생성하므로 이 파일에는 앱 도메인 스키마만 포함한다.
-- 현재 이 마이그레이션은 인프라 검증용 no-op이다 (002_users.sql에서 실제 테이블 추가).

SELECT 1;
