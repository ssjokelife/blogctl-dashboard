# BlogCtl Dashboard — Phase 4~8 전체 로드맵 설계

## 개요

blogctl-dashboard의 Phase 1~3(콘텐츠 생성, 키워드 관리, 자동 발행 Cron)이 완료된 상태에서, 나머지 기능을 순차적으로 구현하는 설계 문서.

**핵심 원칙**: 발행 → 데이터 축적 → 분석 → 수익화 순서로 진행.

---

## Phase 4: 브라우저 자동화 워커 (실제 발행)

### 목표

대시보드에서 생성한 콘텐츠를 blogctl CLI의 파이프라인을 활용하여 실제 블로그 플랫폼에 자동 발행.

### 아키텍처

```
[대시보드 (Vercel)]                         [워커 (Windows PC)]

 수동: "글 생성" → GPT-4o-mini →             Python 서버 (FastAPI/uvicorn)
 publish_job 저장 (status: completed)        ├── Supabase Realtime 구독
                                             │   publish_jobs.status = 'publish_requested'
 수동: "발행" 버튼 →                         │
 status → publish_requested  ──────────→     ├── blogctl import
                                             │   pipeline.publish_only(job) 호출
 Cron: 매일 10시 자동발행 →                  │   (6개 발행 플랫폼 + SEO/SNS)
 콘텐츠 생성 + status → publish_requested    │
                              ──────────→    ├── 결과 업데이트
                                             │   status → published / publish_failed
 대시보드에서 결과 확인 ←────────────────     │   published_url, error_message 저장
                                             │
 워커 상태 표시 ←────────────────────────     └── heartbeat (30초 주기)
 (온라인/오프라인 배지)                           worker_heartbeats 테이블
```

### 발행 흐름

**A) Cron 자동 발행 (즉시 발행)**
1. Vercel Cron → `/api/cron/publish` → GPT-4o-mini로 콘텐츠 생성
2. publish_job 생성 (status: `publish_requested`)
3. 워커가 Realtime으로 감지 → blogctl publish-only 실행
4. 결과 업데이트 (published/publish_failed)

**B) 수동 발행 (확인 후 발행)**
1. 사용자가 "글 생성" → GPT-4o-mini로 콘텐츠 생성
2. publish_job 생성 (status: `completed`)
3. 사용자가 `/jobs/[jobId]`에서 내용 확인
4. "발행" 버튼 클릭 → status를 `publish_requested`로 변경
5. 워커가 감지 → blogctl 실행 → 결과 업데이트

### DB 변경사항

**publish_jobs 테이블 — 새 status 값 추가:**
- `publish_requested` — 발행 요청됨 (워커가 감지)
- `publishing` — 워커가 발행 중
- `published` — 발행 완료
- `publish_failed` — 발행 실패

**publish_jobs 테이블 — 새 컬럼:**
- `published_url TEXT` — 발행된 글 URL
- `published_at TIMESTAMPTZ` — 실제 발행 시각
- `publish_error TEXT` — 발행 실패 시 에러 메시지
- `publish_attempts INT DEFAULT 0` — 발행 시도 횟수

**새 테이블: worker_heartbeats**
```sql
CREATE TABLE worker_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  worker_name TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'online',  -- online, offline
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,  -- { version, platform, blogs_count }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workers"
  ON worker_heartbeats FOR ALL USING (auth.uid() = user_id);

-- Unique per user+worker
CREATE UNIQUE INDEX idx_worker_heartbeats_user_worker
  ON worker_heartbeats(user_id, worker_name);
```

### 워커 구현 (Python)

**위치**: `/mnt/c/jin/projects/blogctl-dashboard/worker/`

**구조:**
```
worker/
├── main.py              # 진입점: Supabase Realtime 구독 + heartbeat
├── publisher.py          # blogctl pipeline 호출 래퍼
├── config.py             # 환경변수, Supabase 클라이언트
├── requirements.txt      # supabase, blogctl 의존성
└── .env                  # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

**핵심 로직 (main.py):**
1. Supabase Realtime으로 `publish_jobs` 테이블 구독 (user_id 필터 필수)
2. `status = 'publish_requested'` INSERT/UPDATE 감지
3. **원자적 job 클레임** — UPDATE with WHERE로 race condition 방지:
   ```sql
   UPDATE publish_jobs
   SET status = 'publishing', updated_at = now()
   WHERE id = $job_id AND status = 'publish_requested'
   RETURNING id;
   ```
   0 rows 반환 시 이미 다른 워커가 처리 중 → skip
4. blogctl의 pipeline 호출 (publish-only 모드)
5. 결과에 따라 status 업데이트 (published/publish_failed)
6. **발행 성공 시** keywords.status를 `published`로 업데이트 (콘텐츠 생성 시점이 아님)
7. 30초 주기 heartbeat 전송
8. Realtime 연결 끊김 시 폴링 폴백: 미처리 `publish_requested` job 조회

**Realtime 구독 필터 (보안):**
```python
# Service Role Key는 RLS를 우회하므로, 반드시 user_id 필터 적용
supabase.realtime.channel('publish_jobs')
  .on('postgres_changes', {
    'event': '*',
    'schema': 'public',
    'table': 'publish_jobs',
    'filter': f'user_id=eq.{WORKER_USER_ID}'
  }, handler)
```

**blogctl 연동:**
- blogctl을 Python path에 추가하여 직접 import
- `pipeline.py`의 publish-only 모드 활용
- blog_config.json의 플랫폼 설정 그대로 사용
- Playwright persistent context로 로그인 세션 재사용

**세션 만료 처리:**
- 플랫폼 로그인 세션 만료는 일반 에러와 구분하여 `publish_error`에 `session_expired` 타입으로 기록
- 세션 만료 시 publish_attempts를 증가시키지 않음 (재로그인 후 재시도 가능)
- 대시보드에서 "세션 만료 — 재로그인 필요" 알림 표시

### 대시보드 UI 변경

**`/jobs/[jobId]` 페이지:**
- "발행" 버튼 추가 (status가 `completed`일 때 표시)
- 발행 상태 표시: 요청됨 → 발행 중 → 완료/실패
- 발행 완료 시 published_url 링크 표시

**헤더 또는 대시보드 — 워커 상태 (Client Component):**
- 워커 상태 배지 (온라인/오프라인) — `"use client"` 컴포넌트로 구현
- Supabase Realtime으로 `worker_heartbeats` 변경 구독하여 실시간 갱신
- 마지막 heartbeat 시간 표시
- 60초 이상 heartbeat 없으면 오프라인으로 표시

### API 변경

**`GET /api/cron/publish` 수정 (기존 GET 핸들러):**
- 콘텐츠 생성 후 status를 `completed` 대신 `publish_requested`로 설정
- **keyword.status는 `published`로 변경하지 않음** — 워커가 실제 발행 성공 시에만 변경
- 워커가 없어도 콘텐츠는 생성됨 (발행만 대기)

**새 API: `POST /api/jobs/[jobId]/publish`**
- 수동 발행 요청 (status → publish_requested)
- 인증 필요 (user_id 확인)

### 지원 플랫폼 (blogctl 전체)

| 유형 | 플랫폼 | 방식 |
|------|--------|------|
| 발행 | Tistory | Playwright (TinyMCE) |
| 발행 | Naver | Playwright (SE One) |
| 발행 | WordPress | REST API |
| 발행 | Blogger | API v3 |
| 발행 | Hashnode | GraphQL API |
| 발행 | Dev.to | REST API |
| SEO | Google Search Console | Playwright |
| SEO | Naver Search Advisor | Playwright |
| SNS | LinkedIn | Playwright |
| SNS | Twitter/X | Playwright |
| 알림 | Telegram | HTTP API |

---

## Phase 5: GSC API 연동 (인덱싱 요청)

### 목표

현재 blogctl이 Playwright로 수행하는 Google Search Console 인덱싱 요청을 API 기반으로 전환하여, 발행 후 자동으로 인덱싱 요청.

### 설계

- Google Search Console Indexing API 사용 (Service Account 기반)
- 발행 완료(status: published) 시 자동 인덱싱 요청
- 대시보드에서 수동 인덱싱 요청도 가능
- **범위**: 현재는 싱글테넌트(본인 블로그만) — Service Account를 본인 GSC 속성에 추가
- 멀티테넌트 확장 시 per-user OAuth 플로우 필요 (Phase 8 이후 고려)

### DB 변경

**publish_jobs 테이블 — 새 컬럼:**
- `indexed_at TIMESTAMPTZ` — 인덱싱 요청 시각
- `index_status TEXT` — pending/requested/indexed/failed

### API

- `POST /api/index` — 수동 인덱싱 요청
- 워커 또는 Vercel 함수에서 자동 호출

### 환경변수 추가

- `GOOGLE_SERVICE_ACCOUNT_KEY` — Service Account JSON

---

## Phase 6: SNS 연동 (LinkedIn/Twitter)

### 목표

발행된 글을 LinkedIn, Twitter에 자동 공유.

### 설계

- blogctl 워커가 발행 완료 후 자동으로 SNS 공유 (기존 Playwright 기반)
- 대시보드에서 공유 상태 확인 가능
- Phase 4 워커에서 이미 blogctl의 SNS publisher를 사용하므로, 주로 UI/상태 관리 추가

### DB 변경

**publish_jobs 테이블 — 새 컬럼:**
- `sns_shared_at TIMESTAMPTZ`
- `sns_status JSONB` — `{ linkedin: 'shared', twitter: 'failed' }`

### 대시보드 UI

- publish_log에 SNS 공유 상태 컬럼 추가
- job 상세에서 SNS 공유 상태 표시

---

## Phase 7: 수익 추적 (애드센스/쿠팡)

### 목표

블로그 수익 데이터를 대시보드에서 추적.

### 설계

**애드센스:**
- Google AdSense API (Service Account 또는 OAuth)
- 일별 수익 데이터 조회 → measurements 테이블에 저장
- Vercel Cron으로 매일 수익 데이터 수집

**쿠팡 파트너스:**
- 쿠팡 파트너스 API로 클릭/수익 데이터 조회
- 일별 데이터 → measurements 테이블에 저장

### DB 변경

- `measurements` 테이블의 기존 JSONB `data` 필드 활용:
  ```json
  {
    "adsense": { "revenue": 1234, "clicks": 56, "impressions": 7890 },
    "coupang": { "revenue": 5678, "clicks": 123 }
  }
  ```

### 대시보드 UI

- 대시보드 요약 카드에 실제 수익 데이터 표시 (현재 하드코딩된 부분 교체)
- 수익 추이 차트 추가 (일별/주별/월별)
- 블로그별 수익 비교

### 환경변수 추가

- `ADSENSE_CLIENT_ID` / `ADSENSE_CLIENT_SECRET`
- `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY`

---

## Phase 8: UI/UX 개선

### 목표

서비스 완성도를 높이는 UI/UX 개선.

### 범위

- **모바일 최적화**: 현재 반응형이지만 세부 조정 필요한 부분
- **로딩 상태**: Skeleton UI, Suspense 경계 추가
- **에러 처리**: error.tsx, not-found.tsx 페이지
- **대시보드 개선**: 위젯 배치 최적화, 필터링 강화
- **알림 센터**: 발행/실패/수익 알림을 대시보드에서 확인
- **설정 페이지 확장**: 워커 설정, API 키 관리, 알림 설정

---

## 기술적 고려사항

### AI 모델

- 모든 콘텐츠 생성에 **GPT-4o-mini** 사용 (기존 GPT-4o에서 변경)
- 비용 절감 + 충분한 품질

### 보안

- 워커 인증: Supabase Service Role Key (워커 전용)
- **Service Role Key는 RLS를 우회** — 모든 쿼리에 `user_id` WHERE 조건 필수
- Realtime 구독: user_id 필터 적용
- heartbeat: user_id 기반 격리
- 워커 환경변수에 `WORKER_USER_ID` 설정하여 범위 제한

### 에러 처리

- 워커 발행 실패: publish_attempts 증가, 3회 초과 시 status를 `publish_failed`로 확정
- **세션 만료**: `session_expired` 에러 타입으로 구분, 재시도 카운트 증가시키지 않음
- 네트워크 단절: Realtime 자동 재연결 + 미처리 job 폴링 폴백
- **keyword status 타이밍**: 콘텐츠 생성 시 `pending` 유지, 실제 발행 성공 시에만 `published`로 변경

### 마이그레이션 경로

- Phase 4 완료 후 기존 "복사+붙여넣기" 방식도 유지 (워커 없이도 사용 가능)
- 각 Phase는 독립적으로 배포 가능
