# "오늘 할 일" Daily Run 워크플로우 설계

## 개요

대시보드에서 "오늘 할 일 진행해줘"를 한 버튼으로 실행하고, 분석 → 발행 → 보고까지 전체 흐름을 사이트에서 확인할 수 있는 기능.

**핵심 가치**: blogctl CLI의 일일 운영을 웹에서 실행 + 모니터링 + AI 보고까지 통합.

**멀티테넌트 범위**: 현재는 단일 사용자(WORKER_USER_ID) 전용. Worker가 로컬 PC에서 동작하고 blogctl Playwright 세션이 필요하므로, 멀티테넌트 확장 시에는 사용자별 Worker 연결 또는 플랫폼 API 추상화가 필요. 지금은 "내가 첫 번째 고객" 단계에 집중.

---

## 전체 흐름

```
[트리거]                [1단계: 분석]           [2단계: 발행]           [3단계: 보고]
대시보드 버튼 클릭  →   블로그별 현황 수집  →   AI 발행 계획 수립  →   AI 종합 리포트
or 매일 10시 자동       • 트래픽/수익 추세      • 블로그별 0~3건       • 오늘의 성과 요약
                        • 키워드풀 현황         • 키워드 자동 선정     • 실행 가능 TODO
                        • 최근 발행 성과        • 자동/수동 모드       • 리노베이션 대상
                        • GSC 인덱싱 상태       • 생성 → (리뷰) → 발행 • 키워드 보충 추천

                        status: analyzing       status: publishing      status: reporting
                                                                        → completed
```

---

## 데이터 모델

### 새 테이블: `daily_runs`

```sql
CREATE TABLE daily_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending → analyzing → plan_ready → publishing → reporting → completed
    -- 실패: failed / 취소: cancelled / 조기 마감: finalize_requested → reporting → completed
  mode TEXT NOT NULL DEFAULT 'auto',
    -- auto: 생성 후 자동 발행 / manual: 생성 후 사용자 리뷰 대기
  trigger_type TEXT NOT NULL DEFAULT 'manual',
    -- manual: 버튼 클릭 / scheduled: 매일 자동
  analysis JSONB,
    -- 블로그별 분석 결과 (아래 구조 참조)
  plan JSONB,
    -- AI 추천 발행 계획 (아래 구조 참조)
  report TEXT,
    -- AI 최종 리포트 (마크다운)
  todos JSONB,
    -- 액션 플랜 TODO 리스트 (아래 구조 참조)
  error TEXT,
    -- 실패 시 에러 메시지
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE daily_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own daily_runs"
  ON daily_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own daily_runs"
  ON daily_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own daily_runs"
  ON daily_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own daily_runs"
  ON daily_runs FOR DELETE USING (auth.uid() = user_id);

-- Index
CREATE INDEX idx_daily_runs_user_status ON daily_runs(user_id, status);
CREATE INDEX idx_daily_runs_user_created ON daily_runs(user_id, created_at DESC);
```

### 기존 테이블 변경: `publish_jobs`

```sql
ALTER TABLE publish_jobs ADD COLUMN daily_run_id UUID REFERENCES daily_runs(id);
CREATE INDEX idx_publish_jobs_daily_run ON publish_jobs(daily_run_id);
```

### JSONB 구조

**analysis** (블로그별 분석):
```json
{
  "blogs": {
    "kyeyangdak": {
      "label": "계양닭",
      "url": "https://kyeyangdak.tistory.com",
      "traffic": {
        "recent_7d_views": 1250,
        "prev_7d_views": 1100,
        "trend": "+13.6%"
      },
      "revenue": {
        "recent_7d_total": 15200,
        "adsense": 12000,
        "coupang_clicks": 8,
        "trend": "+5.2%"
      },
      "keywords": {
        "total": 45,
        "pending": 12,
        "published": 30,
        "urgent": 3,
        "high": 5
      },
      "recent_posts": {
        "last_7d_count": 5,
        "avg_daily": 0.7
      },
      "indexing": {
        "total_published": 30,
        "indexed": 25,
        "pending": 5,
        "rate": "83%"
      }
    }
  },
  "summary": {
    "total_blogs": 3,
    "total_pending_keywords": 35,
    "weekly_revenue": 42000,
    "data_available": true
  }
}
```

**plan** (AI 발행 계획):
```json
{
  "blogs": {
    "kyeyangdak": {
      "recommended_count": 2,
      "reason": "키워드풀 충분, 트래픽 상승 추세 → 모멘텀 유지",
      "keywords": [
        {
          "keyword_id": "uuid",
          "keyword": "에어컨 청소 비용",
          "priority": "urgent",
          "expected_clicks": 150
        },
        {
          "keyword_id": "uuid",
          "keyword": "여름 전기세 절약",
          "priority": "high",
          "expected_clicks": 120
        }
      ]
    },
    "lifezig": {
      "recommended_count": 1,
      "reason": "키워드풀 부족 (5개 남음) — 1건만 발행, 키워드 보충 필요",
      "keywords": [...]
    }
  },
  "total_jobs": 3
}
```

**todos** (액션 플랜):
```json
[
  {
    "id": "todo-1",
    "type": "renovate",
    "priority": "high",
    "blog_id": "kyeyangdak",
    "title": "'에어컨 청소 방법' 글 리노베이션",
    "reason": "3위→7위 순위 하락, 6개월 경과",
    "done": false
  },
  {
    "id": "todo-2",
    "type": "keyword_refill",
    "priority": "medium",
    "blog_id": "lifezig",
    "title": "lifezig 키워드풀 보충 필요",
    "reason": "남은 키워드 5개 — 2주 내 소진 예상",
    "done": false
  },
  {
    "id": "todo-3",
    "type": "indexing",
    "priority": "low",
    "blog_id": "kyeyangdak",
    "title": "미색인 글 5건 재요청",
    "reason": "발행 후 7일 경과, 아직 미색인",
    "done": false
  }
]
```

---

## Worker 변경

### 새 함수: `run_daily_workflow(run_id)`

기존 `scheduled_publish()` 를 확장한 3단계 파이프라인.

```python
async def run_daily_workflow(run_id: str):
    """daily_runs 레코드를 처리하는 메인 파이프라인"""

    # === 1단계: 분석 ===
    update_run(run_id, status="analyzing", started_at=now())

    analysis = collect_analysis(run["user_id"])
    # - measurements 테이블 → 트래픽/수익 추세
    # - keywords 테이블 → 풀 현황
    # - publish_jobs 테이블 → 최근 발행 성과
    # - publish_jobs.index_status → 인덱싱 상태
    # 데이터 없으면 graceful degradation: data_available=false

    update_run(run_id, analysis=analysis)

    # === 2단계: 발행 계획 수립 (GPT-4o) ===
    plan = await generate_publish_plan(analysis)
    # GPT에게 분석 데이터 전달 → 블로그별 발행 건수 + 키워드 추천
    # 집중 블로그: 2~3건, 일반: 0~1건
    # 키워드풀 부족하면 0건 + 보충 추천

    update_run(run_id, status="plan_ready", plan=plan)

    # mode에 따른 분기 (아래 참조)
    mode = run["mode"]

    # === publish_jobs 생성 ===
    job_ids = []
    for blog_id, blog_plan in plan["blogs"].items():
        for kw in blog_plan["keywords"]:
            job_id = create_publish_job(
                user_id=run["user_id"],
                blog_id=blog_id,
                keyword_id=kw["keyword_id"],
                keyword=kw["keyword"],
                daily_run_id=run_id,
                status="generate_requested"
            )
            job_ids.append(job_id)

    update_run(run_id, status="publishing")

    # 생성은 항상 자동 진행 (기존 generate_content 로직)
    # auto 모드: 생성 완료 후 자동으로 publish_requested 설정
    # manual 모드: 생성 완료 후 completed에서 대기 (사용자 리뷰)

    if mode == "auto":
        # 각 job이 completed 되면 자동으로 publish_requested로 변경
        for job_id in job_ids:
            await wait_for_generation(job_id)
            update_job(job_id, status="publish_requested")
            # 기존 claim_and_process가 자동으로 처리

    # manual 모드: 사용자가 개별 job에서 "발행" 버튼 클릭

    # === 3단계: 보고 ===
    # 모든 job이 최종 상태에 도달하면 실행
    # 타임아웃: auto=4시간, manual=24시간. 초과 시 현재 결과로 보고 진행
    timeout = 4 * 3600 if mode == "auto" else 24 * 3600
    await wait_for_all_jobs(job_ids, mode, timeout_seconds=timeout)

    update_run(run_id, status="reporting")

    report, todos = await generate_report(analysis, plan, job_ids)
    # GPT-4o에게 분석 + 계획 + 실행 결과 전달 → 마크다운 리포트 + TODO 생성

    update_run(run_id, status="completed", report=report, todos=todos, completed_at=now())
```

### `scheduled_publish()` 변경

기존 로직을 `run_daily_workflow` 호출로 대체:

```python
async def scheduled_publish():
    """매일 10:00 KST 자동 실행"""
    run_id = create_daily_run(
        user_id=WORKER_USER_ID,
        mode="auto",         # 자동 발행
        trigger_type="scheduled"
    )
    await run_daily_workflow(run_id)

# GPT 계획 생성 실패 시 fallback:
# 기존 scheduled_publish 로직과 동일 — 블로그당 1건, priority+expected_clicks 정렬
async def fallback_plan(analysis):
    plan = {"blogs": {}, "total_jobs": 0}
    for blog_id, blog_data in analysis["blogs"].items():
        if blog_data["keywords"]["pending"] > 0:
            # 기존 로직: priority 순 → expected_clicks 순으로 1건 선택
            keyword = select_top_keyword(blog_id)
            if keyword:
                plan["blogs"][blog_id] = {
                    "recommended_count": 1,
                    "reason": "GPT 계획 실패 — 키워드 우선순위 기반 fallback",
                    "keywords": [keyword]
                }
                plan["total_jobs"] += 1
    return plan
```

### Realtime 구독 추가

기존 `publish_jobs` 구독에 `daily_runs` 구독 추가:

```python
# 기존: publish_jobs 상태 변경 감지
# 추가: daily_runs 상태 변경 감지 (status = 'pending')
channel.on("postgres_changes", {
    "event": "INSERT",
    "schema": "public",
    "table": "daily_runs",
    "filter": f"user_id=eq.{WORKER_USER_ID}"
}, on_daily_run_created)

async def on_daily_run_created(payload):
    run = payload["new"]
    if run["status"] == "pending":
        await run_daily_workflow(run["id"])
```

### Graceful Degradation

measurements 데이터가 없는 경우:

```python
def collect_analysis(user_id):
    # ...
    if not measurements:
        return {
            "blogs": {blog_id: {
                "traffic": None,
                "revenue": None,
                "keywords": keyword_stats,  # 이건 항상 있음
                "recent_posts": post_stats,
                "indexing": index_stats
            }},
            "summary": {"data_available": False}
        }
    # GPT plan 생성 시: data_available=false면 키워드풀 기준으로만 판단
    # "데이터 부족 — 키워드 우선순위 기반 1건 발행" fallback
```

---

## API 변경

### 새 API: `POST /api/daily-run`

Daily Run 생성 (Worker가 감지하여 처리).

```typescript
// src/app/api/daily-run/route.ts
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { mode = "auto" } = await request.json()

  // 오늘 이미 실행 중인 run이 있는지 확인 (KST 기준)
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split("T")[0]
  const { data: existing } = await supabase
    .from("daily_runs")
    .select("id, status")
    .eq("user_id", user.id)
    .gte("created_at", today)
    .not("status", "in", "(completed,failed)")
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({
      error: "이미 진행 중인 실행이 있습니다",
      runId: existing[0].id
    }, { status: 409 })
  }

  const { data, error } = await supabase
    .from("daily_runs")
    .insert({
      user_id: user.id,
      status: "pending",
      mode,
      trigger_type: "manual"
    })
    .select("id")
    .single()

  if (error) return NextNextResponse.json({ error: error.message }, { status: 500 })

  return NextNextResponse.json({ runId: data.id, message: "실행 시작됨" })
}
```

### 새 API: `GET /api/daily-run/[runId]`

Daily Run 상세 조회 (진행 상황 + 연결된 jobs).

```typescript
// src/app/api/daily-run/[runId]/route.ts
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: run } = await supabase
    .from("daily_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", user.id)
    .single()

  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // 연결된 jobs 조회
  const { data: jobs } = await supabase
    .from("publish_jobs")
    .select("id, blog_id, keyword, status, title, published_url, publish_error, created_at")
    .eq("daily_run_id", runId)
    .order("created_at")

  return NextResponse.json({ run, jobs })
}
```

### 새 API: `POST /api/daily-run/[runId]/continue`

manual 모드에서 전체 발행 진행 (plan_ready 상태에서 호출).

```typescript
// src/app/api/daily-run/[runId]/continue/route.ts
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // run 소유권 + 상태 확인
  const { data: run } = await supabase
    .from("daily_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("user_id", user.id)
    .in("status", ["plan_ready", "publishing"])
    .single()

  if (!run) return NextResponse.json({ error: "Not found or invalid status" }, { status: 404 })

  // 해당 run의 completed 상태 jobs를 publish_requested로 변경
  const { data: jobs } = await supabase
    .from("publish_jobs")
    .select("id")
    .eq("daily_run_id", runId)
    .eq("status", "completed")

  for (const job of jobs || []) {
    await supabase
      .from("publish_jobs")
      .update({ status: "publish_requested" })
      .eq("id", job.id)
  }

  return NextResponse.json({ message: "발행 진행 중", count: jobs?.length || 0 })
}
```

### 새 API: `POST /api/daily-run/[runId]/cancel`

실행 중인 Daily Run 취소.

```typescript
// src/app/api/daily-run/[runId]/cancel/route.ts
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 완료/실패가 아닌 run만 취소 가능
  const { data: run } = await supabase
    .from("daily_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("user_id", user.id)
    .not("status", "in", "(completed,failed,cancelled)")
    .single()

  if (!run) return NextResponse.json({ error: "Not found or already finished" }, { status: 404 })

  await supabase
    .from("daily_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", runId)

  return NextResponse.json({ message: "취소됨" })
}
```

### 새 API: `POST /api/daily-run/[runId]/finalize`

manual 모드에서 남은 job을 무시하고 보고 단계로 진행.

```typescript
// src/app/api/daily-run/[runId]/finalize/route.ts
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: run } = await supabase
    .from("daily_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("user_id", user.id)
    .eq("status", "publishing")
    .single()

  if (!run) return NextResponse.json({ error: "Not found or invalid status" }, { status: 404 })

  // Worker가 감지하여 현재 결과로 보고 생성
  await supabase
    .from("daily_runs")
    .update({ status: "finalize_requested" })
    .eq("id", runId)

  return NextResponse.json({ message: "보고 생성 요청됨" })
}
```

---

## UI 설계

### 1. 대시보드 요약 카드 (`/`)

기존 대시보드 상단에 "오늘의 실행" 카드 추가:

```
┌─────────────────────────────────────────────────┐
│  오늘의 실행                          [실행하기] │
│                                                  │
│  (실행 전)  아직 오늘의 실행이 없습니다           │
│                                                  │
│  (진행 중)  ● 분석 중... (2/3 블로그 완료)       │
│             자동 모드 · 10:00 시작               │
│                                                  │
│  (완료)    ✓ 3건 발행 완료                       │
│            TODO 4건 · 상세 보기 →                │
└─────────────────────────────────────────────────┘
```

**"실행하기" 버튼 클릭 시**: 모드 선택 다이얼로그
- 자동 모드: 생성 → 발행까지 자동
- 수동 모드: 생성 후 리뷰 대기
- [실행] 버튼

### 2. 전용 상세 페이지 (`/daily-run/[runId]`)

**3단계 스텝퍼** (상단):
```
[1. 분석] ──── [2. 발행] ──── [3. 보고]
   ✓              ●              ○
  완료          진행 중          대기
```

**분석 섹션** (1단계 완료 후 표시):
- 블로그별 카드: 트래픽 추세, 수익, 키워드풀 현황, 인덱싱 비율
- 데이터 없는 항목은 "데이터 수집 중" 표시

**발행 계획 섹션** (plan_ready 이후 표시):
- AI 추천 사유 + 블로그별 발행 대상 키워드 목록
- manual 모드: "발행 계속" 버튼 (모든 job 리뷰 후)
- 각 job 상태: 대기 → 생성 중 → 생성 완료 → 발행 중 → 발행 완료

**보고 섹션** (reporting 완료 후 표시):
- AI 마크다운 리포트 렌더링
- TODO 체크리스트 (체크 상태 daily_runs.todos JSONB에 저장)

### 3. 실시간 업데이트

- Supabase Realtime으로 `daily_runs` 테이블 구독
- status 변경 시 UI 자동 갱신 (분석 → 발행 → 보고 단계 전환)
- 연결된 `publish_jobs` 상태도 실시간 반영

---

## 트리거

### 수동 (대시보드 버튼)

1. 사용자가 "실행하기" 버튼 클릭 → 모드 선택
2. `POST /api/daily-run` → `daily_runs` 레코드 생성 (status: `pending`)
3. Worker가 Realtime으로 감지 → `run_daily_workflow()` 실행
4. `/daily-run/[runId]` 페이지로 이동

### 자동 (매일 10시)

1. Worker의 `scheduled_publish()` → `daily_runs` 생성 (mode: `auto`, trigger: `scheduled`)
2. `run_daily_workflow()` 자동 실행
3. 사용자는 대시보드에서 결과 확인

---

## manual 모드 상세 흐름

```
daily_run 생성 (pending)
  ↓
Worker: 분석 (analyzing)
  ↓
Worker: AI 발행 계획 (plan_ready) ← 여기서 일시정지하지 않음
  ↓
Worker: publish_jobs 생성 + 콘텐츠 생성 (publishing)
  ↓
각 job: status = completed (생성 완료, 발행 대기)
  ↓
사용자: /jobs/[jobId] 에서 개별 리뷰
  ↓
사용자: /daily-run/[runId] 에서 "발행 계속" 클릭
  또는 개별 job에서 "발행" 버튼 클릭
  ↓
Worker: 발행 처리 (기존 claim_and_process)
  ↓
모든 job 완료 → Worker: 보고 생성 (reporting → completed)
```

---

## 에러 처리

| 상황 | 처리 |
|------|------|
| 분석 실패 | daily_run.status → failed, error 메시지 저장 |
| GPT 계획 생성 실패 | 키워드 우선순위 기반 fallback (블로그당 1건) |
| 개별 job 발행 실패 | 해당 job만 실패, 나머지 계속 진행 |
| 세션 만료 | 기존 session_expired 로직 유지, 보고서에 포함 |
| measurements 데이터 없음 | analysis.summary.data_available = false, 키워드 기준으로만 판단 |
| 모든 job 실패 | 보고서에 실패 원인 분석 포함, TODO에 "세션 갱신" 추가 |
| Worker 오프라인 | 대시보드에서 Worker 상태 표시, 실행 불가 안내 |
| 대기 타임아웃 | auto=4시간, manual=24시간 초과 시 현재 결과로 보고 진행 |
| 사용자 취소 | cancel API로 즉시 취소, 진행 중 job은 그대로 완료 |
| manual 조기 마감 | finalize API로 미발행 job 무시, 현재까지 결과로 보고 생성 |

---

## 파일 변경 목록

### 새 파일

| 파일 | 역할 |
|------|------|
| `src/app/api/daily-run/route.ts` | Daily Run 생성 API |
| `src/app/api/daily-run/[runId]/route.ts` | Daily Run 조회 API |
| `src/app/api/daily-run/[runId]/continue/route.ts` | manual 모드 발행 진행 API |
| `src/app/api/daily-run/[runId]/cancel/route.ts` | 실행 취소 API |
| `src/app/api/daily-run/[runId]/finalize/route.ts` | 조기 마감 → 보고 진행 API |
| `src/app/daily-run/[runId]/page.tsx` | Daily Run 상세 페이지 |
| `src/components/daily-run-card.tsx` | 대시보드 요약 카드 |
| `src/components/daily-run-stepper.tsx` | 3단계 스텝퍼 |
| `src/components/daily-run-trigger.tsx` | 실행 버튼 + 모드 선택 다이얼로그 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/page.tsx` | DailyRunCard 추가 |
| `src/lib/data.ts` | `getTodayRun()`, `getDailyRun()` 함수 추가 |
| `worker/main.py` | `run_daily_workflow()`, `collect_analysis()`, `generate_publish_plan()`, `generate_report()` 추가. `scheduled_publish()` → daily run 호출로 변경. Realtime에 `daily_runs` 구독 추가 |

### DB 마이그레이션

| 변경 | SQL |
|------|-----|
| 새 테이블 | `daily_runs` (위 스키마 참조) |
| 컬럼 추가 | `publish_jobs.daily_run_id` FK |
