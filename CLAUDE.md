# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

블로그 자동 운영 + 수익화 관리 SaaS 서비스.
블로거가 가입해서 자기 블로그를 등록하고, 키워드·발행·수익을 관리하는 멀티테넌트 서비스.
"내가 첫 번째 고객" — 직접 이용자로서 써서 수익을 내면서, 다른 블로거도 쓸 수 있는 서비스로 발전.

**프로덕션**: https://blogctl-dashboard.vercel.app

## 명령어

```bash
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run lint         # ESLint
```

## 기술 스택

- Next.js 16 (App Router, Turbopack) — `node_modules/next/dist/docs/` 참조 필수
- React 19, TypeScript 5 (strict)
- shadcn/ui (base-nova) + Tailwind CSS v4 + Recharts
- Supabase (Auth + Postgres + RLS) — Google OAuth
- OpenAI GPT-4o — 콘텐츠 생성, 키워드 추천, 리노베이션
- Vercel 배포 + Cron Jobs (매일 10시 자동 발행)
- 경로 alias: `@/*` → `./src/*`

## 아키텍처

### 데이터 흐름

```
Supabase Postgres (RLS) → src/lib/data.ts (async) → Server Component
OpenAI GPT-4o → /api/publish, /api/keywords/suggest, /api/renovate
Telegram Bot API → src/lib/telegram.ts (발행 알림)
```

### 핵심 모듈

- `src/lib/data.ts` — 데이터 로딩 (Supabase 쿼리, 모든 함수 async)
- `src/lib/supabase/server.ts` — 서버 Supabase 클라이언트
- `src/lib/supabase/client.ts` — 브라우저 Supabase 클라이언트
- `src/lib/telegram.ts` — Telegram 알림
- `src/proxy.ts` — 세션 갱신 + 미인증 → /login 리다이렉트
- `src/components/header.tsx` — 공통 헤더 (Server Component, 프로필 + 로그아웃)

### DB 스키마

| 테이블 | 역할 |
|--------|------|
| `profiles` | 사용자 프로필 (auth.users 트리거 자동 생성) |
| `blogs` | 블로그 (페르소나, 카테고리, 스타일, accounts 포함) |
| `keywords` | 키워드풀 + 예측 데이터 |
| `publish_logs` | 발행 로그 |
| `publish_jobs` | AI 콘텐츠 생성 작업 (상태, 본문, 태그, 메타) |
| `measurements` | 일일 측정 (jsonb) |

모든 테이블 RLS — `auth.uid() = user_id`

### 페이지 구조

| 경로 | 역할 |
|------|------|
| `/` | 대시보드 — 요약 카드 + 발행 추이 차트 + 블로그/키워드 테이블 |
| `/keywords` | 전체 키워드 현황 |
| `/publish-log` | 발행 로그 (날짜별 그룹) |
| `/blogs/[blogId]` | 블로그 상세 — 페르소나 편집, 키워드 CRUD, AI 추천, 리노베이션, 글 생성 |
| `/jobs/[jobId]` | 발행 준비 — 제목/태그/메타/HTML 복사 버튼 |
| `/settings` | 프로필 + 블로그 관리 (추가/삭제) |
| `/login` | Google OAuth 로그인 |
| `/onboarding` | 신규 사용자 블로그 등록 |

### API Routes

| 경로 | 역할 |
|------|------|
| `POST /api/publish` | GPT-4o 콘텐츠 생성 (제목+HTML+태그+메타) + Telegram 알림 |
| `POST /api/keywords/suggest` | AI 키워드 추천 (콘텐츠 갭 분석) |
| `POST /api/keywords/add` | 키워드 추가 |
| `POST /api/renovate` | 기존 글 리노베이션 AI 분석 |
| `GET /api/cron/publish` | 매일 10시 자동 발행 (Vercel Cron, CRON_SECRET 인증) |
| `GET /api/dashboard` | 대시보드 JSON API |

## 환경변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CRON_SECRET
```

## 마이그레이션 스크립트

- `scripts/migrate-to-supabase.ts` — JSON → Supabase 데이터 마이그레이션
- `scripts/migrate-personas.ts` — blog_config.json 페르소나 → blogs 테이블
- 실행: `export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/<script>.ts`

## 개발 규칙

- **라이트 모드** 기본 (globals.css에서 강제)
- 한국어 UI
- 모바일 반응형
- Next.js 16 비동기 API: `await cookies()`, `await headers()`, `await params`, `await searchParams`
- Server Component 기본, 인터랙션 필요시만 `"use client"`

## 관련 프로젝트

- **blogctl (Python CLI)**: `/mnt/c/jin/projects/my-resume/blogs/scripts/blogctl/`
  - 9단계 발행 파이프라인, Playwright 기반 플랫폼 발행
  - 이 사이트는 blogctl의 웹 버전으로, 점진적으로 기능을 이전 중
