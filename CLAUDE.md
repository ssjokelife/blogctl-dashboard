# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

블로그 자동 운영 + 수익화 관리 SaaS 서비스.
블로거가 가입해서 자기 블로그를 등록하고, 키워드·발행·수익을 관리하는 멀티테넌트 서비스.
"내가 첫 번째 고객" — 직접 이용자로서 써서 수익을 내면서, 다른 블로거도 쓸 수 있는 서비스로 발전.

## 명령어

```bash
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run lint         # ESLint (eslint)
./scripts/sync-data.sh  # 외부 blogctl에서 data/ 디렉토리로 JSON 동기화
```

## 기술 스택

- Next.js 16 (App Router, Turbopack) — `node_modules/next/dist/docs/` 참조 필수
- React 19, TypeScript 5 (strict)
- shadcn/ui (base-nova 스타일) + Tailwind CSS v4 + Recharts
- 경로 alias: `@/*` → `./src/*`

- Supabase (Auth + Postgres DB + RLS) — Google OAuth 로그인
- `@supabase/supabase-js` + `@supabase/ssr`

**예정**: Vercel 배포

## 아키텍처

### 데이터 흐름

```
Supabase Postgres (RLS) → src/lib/data.ts (async 함수) → Server Component 페이지
```

- `src/lib/data.ts` — 모든 데이터 로딩의 단일 진입점. Supabase 쿼리 사용 (모든 함수 async)
- `src/lib/supabase/server.ts` — 서버용 Supabase 클라이언트 (쿠키 기반 인증)
- `src/lib/supabase/client.ts` — 브라우저용 Supabase 클라이언트
- `src/proxy.ts` — Next.js 16 proxy (세션 갱신 + 미인증 → /login 리다이렉트)
- `BLOG_LABELS` — 12개 블로그의 한국어 라벨 (data.ts에서 export)

### DB 스키마 (supabase/schema.sql)

| 테이블 | 역할 |
|--------|------|
| `profiles` | 사용자 프로필 (auth.users 확장, 트리거로 자동 생성) |
| `blogs` | 블로그 등록 (id + user_id 복합 PK) |
| `keywords` | 키워드풀 + 예측 데이터 |
| `publish_logs` | 발행 로그 |
| `measurements` | 일일 측정 (jsonb) |

모든 테이블에 RLS 적용 — `auth.uid() = user_id`

### 페이지 구조

| 경로 | 역할 | 데이터 |
|------|------|--------|
| `/` | 대시보드 — 요약 카드, 블로그별 현황, 최근 발행, 키워드 상태 | `getDashboardData()` |
| `/keywords` | 키워드 관리 — 블로그 선택, 대기/발행 키워드 테이블 | `getKeywordPool()`, `getPredictions()` |
| `/publish-log` | 발행 로그 — 날짜별 그룹, 블로그별 색상 배지 | `getRecentPublished()` |
| `/login` | Google OAuth 로그인 페이지 | — |
| `/auth/callback` | OAuth 콜백 (코드 → 세션 교환) | — |
| `/api/dashboard` | JSON API (dynamic, no cache) | `getDashboardData()` |

### 컴포넌트

- `src/components/ui/` — shadcn/ui 컴포넌트 (Card, Badge, Button, Table, Tabs, Chart)
- 페이지는 기본 Server Component, 인터랙션 필요시만 `"use client"`

## 데이터 마이그레이션

- `data/` — 원본 JSON 파일 (레거시, 마이그레이션 소스로만 사용)
- `scripts/migrate-to-supabase.ts` — JSON → Supabase 마이그레이션 스크립트
  - 실행: `export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/migrate-to-supabase.ts`
- `scripts/sync-data.sh` — 외부 blogctl에서 data/ 동기화 (레거시)

## 개발 규칙

- **라이트 모드** 기본 (다크 모드 제거됨, globals.css에서 강제)
- 한국어 UI
- 모바일 반응형 (grid-cols-1 → md:grid-cols-4)
- Next.js 16 비동기 API: `await cookies()`, `await headers()`, `await params`, `await searchParams`

## MVP 범위 (1차)

1. 대시보드 — 블로그별 발행 현황 + GSC + 수익
2. 키워드 관리 — 풀 조회, 예측 점수, 우선순위
3. 발행 로그 — 발행된 글 목록 + URL
