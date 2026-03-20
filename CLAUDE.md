# BlogCtl Dashboard

## 프로젝트 개요
블로그 자동 운영 + 수익화 관리 SaaS 대시보드.
"내가 첫 번째 고객" — 직접 써서 수익을 내면서, 다른 블로거도 쓸 수 있는 서비스로 발전.

## 기술 스택
- Next.js 16 (App Router, Turbopack)
- shadcn/ui + Tailwind CSS
- TypeScript
- Neon Postgres (예정)
- Clerk 인증 (예정)
- Vercel 배포 (예정)

## 관련 프로젝트
- **blogctl (Python)**: `/mnt/c/jin/projects/my-resume/blogs/scripts/blogctl/`
- **데이터 소스**: `/mnt/c/jin/projects/my-resume/blogs/scripts/`
  - `publish_log.json` — 발행 로그 (1300+ 글)
  - `*_keyword_pool.json` — 13개 블로그 키워드풀
  - `measurement_log.json` — 일일 측정 데이터
  - `keyword_predictions.json` — 키워드 성과 예측
  - `blog_config.json` — 블로그 설정

## MVP 범위 (1차)
1. 대시보드 — 블로그별 발행 현황 + GSC + 수익
2. 키워드 관리 — 풀 조회, 예측 점수, 우선순위
3. 발행 로그 — 발행된 글 목록 + URL

## 데이터 연동 방식 (MVP)
- 초기: JSON 파일 직접 읽기 (API route에서 fs.readFile)
- 이후: Neon Postgres DB로 마이그레이션

## 개발 규칙
- 다크 모드 기본
- 한국어 UI
- 모바일 반응형
