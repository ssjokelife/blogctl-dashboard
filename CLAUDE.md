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

**예정**: Supabase (Auth + Postgres DB + RLS), Vercel 배포

## 아키텍처

### 데이터 흐름

```
data/*.json (16개 파일) → src/lib/data.ts (30초 TTL 인메모리 캐시) → 페이지/API
```

- `src/lib/data.ts`가 모든 데이터 로딩의 단일 진입점. `readJson<T>()`로 파일 읽기 + 캐싱
- `detectBlog(url)` — URL 패턴으로 블로그 ID 매핑 (BLOG_URL_MAP)
- `POOL_FILES` — 블로그 ID별 키워드풀 파일 매핑
- `BLOG_LABELS` — 13개 블로그의 한국어 라벨 (모든 페이지에서 공유)

### 페이지 구조

| 경로 | 역할 | 데이터 |
|------|------|--------|
| `/` | 대시보드 — 요약 카드, 블로그별 현황, 최근 발행, 키워드 상태 | `getDashboardData()` |
| `/keywords` | 키워드 관리 — 블로그 선택, 대기/발행 키워드 테이블 | `getKeywordPool()`, `getPredictions()` |
| `/publish-log` | 발행 로그 — 날짜별 그룹, 블로그별 색상 배지 | `getPublishLog()` |
| `/api/dashboard` | JSON API (dynamic, no cache) | `getDashboardData()` |

### 컴포넌트

- `src/components/ui/` — shadcn/ui 컴포넌트 (Card, Badge, Button, Table, Tabs, Chart)
- 페이지는 기본 Server Component, 인터랙션 필요시만 `"use client"`

## 데이터 파일 (data/)

외부 blogctl 프로젝트(`/mnt/c/jin/projects/my-resume/blogs/scripts/`)에서 `sync-data.sh`로 동기화.
Vercel 배포 시 번들에 포함됨 (프로젝트 상대경로 사용).

주요 파일:
- `publish_log.json` — 발행 로그 (1300+ 글)
- `*_keyword_pool.json` — 13개 블로그 키워드풀
- `measurement_log.json` — 일일 측정 데이터 (7000+ 줄)
- `keyword_predictions.json` — 키워드 성과 예측

## 개발 규칙

- **라이트 모드** 기본 (다크 모드 제거됨, globals.css에서 강제)
- 한국어 UI
- 모바일 반응형 (grid-cols-1 → md:grid-cols-4)
- Next.js 16 비동기 API: `await cookies()`, `await headers()`, `await params`, `await searchParams`

## MVP 범위 (1차)

1. 대시보드 — 블로그별 발행 현황 + GSC + 수익
2. 키워드 관리 — 풀 조회, 예측 점수, 우선순위
3. 발행 로그 — 발행된 글 목록 + URL
