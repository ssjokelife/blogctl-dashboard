# Phase 4: 브라우저 자동화 워커 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase Realtime으로 publish_jobs를 감지하는 Python 워커를 만들어, blogctl 파이프라인으로 실제 블로그 발행까지 자동화한다.

**Architecture:** 대시보드(Vercel)가 콘텐츠를 생성하면 publish_jobs에 `publish_requested` 상태로 저장. Windows PC에서 실행되는 Python 워커가 Supabase Realtime으로 이를 감지하고, blogctl의 `_publish_and_postprocess()`를 호출하여 실제 발행. 결과는 다시 publish_jobs에 업데이트.

**Tech Stack:** Python 3.11+, supabase-py, asyncio, blogctl (local import), Next.js 16 (대시보드 변경)

**Spec:** `docs/superpowers/specs/2026-03-22-full-roadmap-design.md`

---

## 파일 구조

### 새로 생성

```
worker/
├── main.py              # 진입점: Realtime 구독 + heartbeat + 폴링 폴백
├── publisher.py          # blogctl Pipeline 래퍼 — job → publish_only 변환
├── config.py             # 환경변수 로드, Supabase 클라이언트
├── requirements.txt      # supabase, python-dotenv
└── .env.example          # 환경변수 템플릿
```

### 대시보드 수정

```
src/app/api/publish/route.ts           # GPT-4o → GPT-4o-mini, keyword status 변경 제거
src/app/api/cron/publish/route.ts      # status: publish_requested, keyword 변경 제거, GPT-4o-mini
src/app/api/jobs/[jobId]/publish/route.ts  # 새 API: 수동 발행 요청
src/app/jobs/[jobId]/page.tsx          # "발행" 버튼 + 발행 상태 표시
src/components/publish-button-platform.tsx  # 플랫폼 발행 버튼 (Client Component)
src/components/worker-status.tsx       # 워커 온/오프라인 배지 (Client Component)
src/components/header.tsx              # 워커 상태 배지 추가
```

---

## Task 1: DB 스키마 변경 (publish_jobs 컬럼 + worker_heartbeats 테이블)

**Files:**
- Create: `scripts/migrate-phase4.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- publish_jobs 새 컬럼
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_error TEXT;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_error_type TEXT;  -- 'session_expired' | 'publish_error'
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_attempts INT DEFAULT 0;

-- worker_heartbeats 테이블
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  worker_name TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'online',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- 단일 RLS 정책: 사용자는 자기 워커만 관리 (Service Role Key는 RLS 자동 우회)
CREATE POLICY "Users can manage own workers"
  ON worker_heartbeats FOR ALL USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_heartbeats_user_worker
  ON worker_heartbeats(user_id, worker_name);

-- publish_jobs에 Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE publish_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE worker_heartbeats;

-- 확인: keyword_id 컬럼이 publish_jobs에 이미 존재하는지 검증
-- (기존 /api/publish에서 keyword_id를 INSERT하므로 이미 존재해야 함)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'publish_jobs' AND column_name = 'keyword_id';
```

- [ ] **Step 2: Supabase Dashboard에서 SQL 실행**

Supabase Dashboard → SQL Editor에서 위 SQL 실행.
확인: `SELECT column_name FROM information_schema.columns WHERE table_name = 'publish_jobs'` 로 새 컬럼 확인.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-phase4.sql
git commit -m "db: add Phase 4 schema — publish_jobs columns + worker_heartbeats table"
```

---

## Task 2: API 수정 — GPT-4o-mini + keyword status 타이밍 변경

**Files:**
- Modify: `src/app/api/publish/route.ts:83-141`
- Modify: `src/app/api/cron/publish/route.ts:83-124`

- [ ] **Step 1: `/api/publish` — GPT-4o → GPT-4o-mini 변경**

`src/app/api/publish/route.ts` 에서:
```typescript
// 변경 전 (line 89)
model: 'gpt-4o',
// 변경 후
model: 'gpt-4o-mini',
```

그리고 metadata에서도:
```typescript
// 변경 전 (line 129)
model: 'gpt-4o', tokens: completion.usage?.total_tokens,
// 변경 후
model: 'gpt-4o-mini', tokens: completion.usage?.total_tokens,
```

- [ ] **Step 2: `/api/publish` — keyword status 업데이트 제거**

`src/app/api/publish/route.ts`에서 lines 135-141 (keyword status를 published로 바꾸는 부분) 제거:
```typescript
// 삭제할 코드:
    if (keywordId) {
      await supabase
        .from('keywords')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', keywordId)
        .eq('user_id', user.id)
    }
```

- [ ] **Step 3: `/api/cron/publish` — GPT-4o-mini + status 변경 + keyword 제거**

`src/app/api/cron/publish/route.ts` 에서:

1. model 변경 (line 84): `'gpt-4o'` → `'gpt-4o-mini'`
2. **프롬프트를 JSON 응답 형식으로 변경** — 현재 cron은 raw HTML만 생성하지만,
   워커가 tags/meta_description을 필요로 함. `/api/publish`와 동일한 JSON 형식 사용:
   - system 프롬프트에 JSON 응답 형식 지시 추가
   - `response_format: { type: 'json_object' }` 추가
   - 응답 파싱: `JSON.parse(raw)` → `{ title, html, tags, meta_description }`
   - (`/api/publish/route.ts`의 lines 57-106 패턴을 그대로 복사)
3. job status 변경 (line 112): `status: 'completed'` → `status: 'publish_requested'`
4. metadata에 tags, meta_description 포함:
   `metadata: { title, tags, meta_description, model: 'gpt-4o-mini', tokens, source: 'cron' }`
5. keyword status 업데이트 제거 (lines 121-124):
```typescript
// 삭제:
      await supabase
        .from('keywords')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', nextKeyword.id)
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공, 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/app/api/publish/route.ts src/app/api/cron/publish/route.ts
git commit -m "feat: switch to GPT-4o-mini, defer keyword status to worker"
```

---

## Task 3: 수동 발행 요청 API

**Files:**
- Create: `src/app/api/jobs/[jobId]/publish/route.ts`

- [ ] **Step 1: API 라우트 생성**

```typescript
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 원자적 상태 전환: completed → publish_requested
  const { data: job, error } = await supabase
    .from('publish_jobs')
    .update({
      status: 'publish_requested',
      publish_attempts: 0,
      publish_error: null,
    })
    .eq('id', Number(jobId))
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .select()
    .single()

  if (error || !job) {
    return NextResponse.json(
      { error: '발행 요청할 수 없는 상태입니다.' },
      { status: 400 }
    )
  }

  return NextResponse.json({ message: '발행 요청됨', jobId: job.id })
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[jobId]/publish/route.ts
git commit -m "feat: add manual publish request API endpoint"
```

---

## Task 4: Job 상세 페이지 — 발행 버튼 + 상태 표시

**Files:**
- Create: `src/components/publish-button-platform.tsx`
- Modify: `src/app/jobs/[jobId]/page.tsx`

- [ ] **Step 1: 플랫폼 발행 버튼 컴포넌트 생성**

`src/components/publish-button-platform.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function PublishButtonPlatform({ jobId }: { jobId: number }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handlePublish() {
    setState('loading')
    try {
      const res = await fetch(`/api/jobs/${jobId}/publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setState('error')
        setMessage(data.error || '요청 실패')
        return
      }
      setState('done')
      setMessage('발행 요청됨')
    } catch {
      setState('error')
      setMessage('네트워크 오류')
    }
  }

  return (
    <Button
      onClick={handlePublish}
      disabled={state === 'loading' || state === 'done'}
      variant={state === 'error' ? 'destructive' : state === 'done' ? 'outline' : 'default'}
      className={state === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
    >
      {state === 'idle' && '블로그에 발행'}
      {state === 'loading' && '요청 중...'}
      {state === 'done' && message}
      {state === 'error' && message}
    </Button>
  )
}
```

- [ ] **Step 2: Job 상세 페이지에 발행 버튼 + 상태 추가**

`src/app/jobs/[jobId]/page.tsx` 수정:

1. import 추가:
```tsx
import { PublishButtonPlatform } from '@/components/publish-button-platform'
```

2. Badge 영역 (line 39-47)에 새 status 값들 추가:
```tsx
<Badge className={
  job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
  job.status === 'published' ? 'bg-blue-100 text-blue-700' :
  job.status === 'publish_requested' ? 'bg-amber-100 text-amber-700' :
  job.status === 'publishing' ? 'bg-purple-100 text-purple-700' :
  job.status === 'publish_failed' ? 'bg-red-100 text-red-700' :
  job.status === 'failed' ? 'bg-red-100 text-red-700' :
  'bg-blue-100 text-blue-700'
}>
  {job.status === 'completed' ? '생성 완료' :
   job.status === 'published' ? '발행됨' :
   job.status === 'publish_requested' ? '발행 대기' :
   job.status === 'publishing' ? '발행 중' :
   job.status === 'publish_failed' ? '발행 실패' :
   job.status === 'failed' ? '생성 실패' : '진행 중'}
</Badge>
```

3. "발행" 버튼 — Badge 행 뒤에 추가:
```tsx
{job.status === 'completed' && (
  <PublishButtonPlatform jobId={job.id} />
)}
```

4. 발행 결과 표시 — 에러 카드 아래에 추가:
```tsx
{job.published_url && (
  <Card>
    <CardContent className="py-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">발행 URL</p>
          <a href={job.published_url} target="_blank" rel="noopener noreferrer"
             className="text-emerald-600 hover:underline text-sm">
            {job.published_url}
          </a>
        </div>
        <CopyButton text={job.published_url} label="URL 복사" />
      </div>
    </CardContent>
  </Card>
)}

{job.publish_error && (
  <Card>
    <CardContent className="py-4">
      {job.publish_error_type === 'session_expired' ? (
        <div>
          <p className="text-sm text-amber-600 font-medium">세션 만료 — 재로그인 필요</p>
          <p className="text-xs text-gray-500 mt-1">워커 PC에서 `blogctl login --blog {job.blog_id}` 실행 후 재시도하세요.</p>
        </div>
      ) : (
        <p className="text-sm text-red-600">발행 오류: {job.publish_error}</p>
      )}
      {job.publish_attempts > 0 && (
        <p className="text-xs text-gray-400 mt-1">시도 횟수: {job.publish_attempts}/3</p>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/publish-button-platform.tsx src/app/jobs/[jobId]/page.tsx
git commit -m "feat: add platform publish button and status display on job detail"
```

---

## Task 5: 워커 상태 배지

**Files:**
- Create: `src/components/worker-status.tsx`
- Modify: `src/components/header.tsx:19-24`

- [ ] **Step 1: WorkerStatus Client Component 생성**

`src/components/worker-status.tsx`:
```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function WorkerStatus() {
  const [online, setOnline] = useState<boolean | null>(null)
  const lastSeenRef = useRef<string | null>(null)

  // Realtime 구독 (한 번만)
  useEffect(() => {
    const supabase = createClient()

    async function checkStatus() {
      const { data } = await supabase
        .from('worker_heartbeats')
        .select('last_heartbeat_at, status')
        .order('last_heartbeat_at', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        const elapsed = Date.now() - new Date(data.last_heartbeat_at).getTime()
        setOnline(elapsed < 60_000)
        lastSeenRef.current = data.last_heartbeat_at
      } else {
        setOnline(false)
      }
    }

    checkStatus()

    const channel = supabase
      .channel('worker-heartbeats')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'worker_heartbeats',
      }, (payload) => {
        const row = payload.new as { last_heartbeat_at: string; status: string }
        if (row) {
          setOnline(true)
          lastSeenRef.current = row.last_heartbeat_at
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // 오프라인 체크 타이머 (별도 effect)
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastSeenRef.current) {
        const elapsed = Date.now() - new Date(lastSeenRef.current).getTime()
        if (elapsed > 60_000) setOnline(false)
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (online === null) return null

  return (
    <div className="flex items-center gap-1.5" title={lastSeenRef.current ? `마지막: ${new Date(lastSeenRef.current).toLocaleTimeString()}` : '워커 미연결'}>
      <div className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      <span className="text-xs text-gray-400">워커</span>
    </div>
  )
}
```

- [ ] **Step 2: Header에 WorkerStatus 추가**

`src/components/header.tsx` 수정:

1. import 추가:
```tsx
import { WorkerStatus } from './worker-status'
```

2. 로고 영역 뒤 (line 24, nav 앞)에 추가:
```tsx
<WorkerStatus />
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 4: Commit**

```bash
git add src/components/worker-status.tsx src/components/header.tsx
git commit -m "feat: add worker online/offline status badge in header"
```

---

## Task 6: Python 워커 — config + requirements

**Files:**
- Create: `worker/config.py`
- Create: `worker/requirements.txt`
- Create: `worker/.env.example`

- [ ] **Step 1: requirements.txt 생성**

`worker/requirements.txt`:
```
supabase>=2.0.0
python-dotenv>=1.0.0
```

- [ ] **Step 2: .env.example 생성**

`worker/.env.example`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_USER_ID=your-supabase-user-uuid
BLOGCTL_PATH=/mnt/c/jin/projects/my-resume/blogs/scripts
```

- [ ] **Step 3: config.py 생성**

`worker/config.py`:
```python
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_USER_ID = os.environ["WORKER_USER_ID"]
BLOGCTL_PATH = os.environ.get("BLOGCTL_PATH", "/mnt/c/jin/projects/my-resume/blogs/scripts")

HEARTBEAT_INTERVAL = 30  # seconds
POLL_INTERVAL = 60  # fallback polling interval
MAX_PUBLISH_ATTEMPTS = 3


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
```

- [ ] **Step 4: Commit**

```bash
git add worker/
git commit -m "feat: add worker config, requirements, and env template"
```

---

## Task 7: Python 워커 — publisher (blogctl 래퍼)

**Files:**
- Create: `worker/publisher.py`

- [ ] **Step 1: publisher.py 생성**

```python
"""blogctl Pipeline 래퍼 — publish_job → blogctl publish_only 변환"""
import sys
import json
import logging
from pathlib import Path
from typing import Any

from config import BLOGCTL_PATH

logger = logging.getLogger("worker.publisher")


def _ensure_blogctl_path():
    """blogctl을 import 경로에 추가"""
    blogctl_parent = str(Path(BLOGCTL_PATH))
    if blogctl_parent not in sys.path:
        sys.path.insert(0, blogctl_parent)


async def publish_job(job: dict[str, Any]) -> dict[str, Any]:
    """
    publish_job 레코드를 받아 blogctl로 실제 발행.

    Returns:
        {
            "success": bool,
            "published_url": str | None,
            "error": str | None,
            "error_type": "session_expired" | "publish_error" | None,
            "results": dict  # 플랫폼별 결과
        }
    """
    _ensure_blogctl_path()

    blog_id = job["blog_id"]
    title = job.get("title", job["keyword"])
    content_html = job.get("content_html", "")
    metadata = job.get("metadata") or {}
    tags = metadata.get("tags", [])
    meta_description = metadata.get("meta_description", "")

    if not content_html:
        return {
            "success": False,
            "published_url": None,
            "error": "content_html이 비어 있습니다",
            "error_type": "publish_error",
            "results": {},
        }

    # blogctl의 실제 HTML_DIR에 파일 생성 (monkey-patch 불가)
    from blogctl.config import HTML_DIR

    filename = f"job-{job['id']}"
    html_path = HTML_DIR / f"{filename}.html"
    meta_path = HTML_DIR / f"{filename}.meta.json"

    html_path.write_text(content_html, encoding="utf-8")
    meta_path.write_text(json.dumps({
        "title": title,
        "tags": tags,
        "keyword": job.get("keyword", ""),
        "category": metadata.get("category", ""),
        "meta_description": meta_description,
    }, ensure_ascii=False), encoding="utf-8")

    try:
        from blogctl.config import Config
        from blogctl.pipeline import Pipeline

        # Config()는 인자를 받지 않음 — blog_config.json 경로는 내부 하드코딩
        config = Config()
        pipeline = Pipeline(config, blog_id)
        result = await pipeline.run(filename=filename, publish_only=True)

        success = result.get("success", False)
        pub_results = result.get("steps", {}).get("publish", {})
        published_url = None

        # 발행 URL 추출 (pub_log에서)
        if success:
            entry = pipeline.pub_log.get_entry(filename)
            if entry:
                published_url = entry.get("url")
            else:
                logger.warning(f"발행 성공으로 보고되었으나 pub_log에 URL 없음 — job {job['id']}")

        error_msg = None
        error_type = None
        if not success:
            error_msg = pub_results.get("error", "발행 실패")
            # 세션 만료 감지
            if any(kw in str(error_msg).lower() for kw in ["login", "로그인", "session", "세션"]):
                error_type = "session_expired"
            else:
                error_type = "publish_error"

        return {
            "success": success,
            "published_url": published_url,
            "error": error_msg,
            "error_type": error_type,
            "results": pub_results,
        }

    except Exception as e:
        logger.exception(f"blogctl 실행 오류: {e}")
        return {
            "success": False,
            "published_url": None,
            "error": str(e),
            "error_type": "publish_error",
            "results": {},
        }
    finally:
        # blogctl HTML_DIR에서 임시 파일 정리
        html_path.unlink(missing_ok=True)
        meta_path.unlink(missing_ok=True)
```

- [ ] **Step 2: Commit**

```bash
git add worker/publisher.py
git commit -m "feat: add blogctl publisher wrapper for worker"
```

---

## Task 8: Python 워커 — main (Realtime + heartbeat + 폴링)

**Files:**
- Create: `worker/main.py`

- [ ] **Step 1: main.py 생성**

```python
"""BlogCtl Worker — Supabase Realtime 기반 자동 발행 워커"""
import asyncio
import logging
import signal
from datetime import datetime, timezone

from config import (
    get_supabase, WORKER_USER_ID, HEARTBEAT_INTERVAL,
    POLL_INTERVAL, MAX_PUBLISH_ATTEMPTS,
)
from publisher import publish_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("worker")

supabase = get_supabase()
running = True


def handle_shutdown(signum, frame):
    global running
    logger.info("종료 신호 수신, 워커 종료 중...")
    running = False


signal.signal(signal.SIGINT, handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)


async def claim_and_process(job_id: int):
    """원자적 클레임 + 발행 처리"""
    # 원자적 클레임: publish_requested → publishing
    result = supabase.table("publish_jobs").update({
        "status": "publishing",
    }).eq("id", job_id).eq("status", "publish_requested").execute()

    if not result.data:
        logger.info(f"  Job {job_id}: 이미 다른 워커가 처리 중, skip")
        return

    job = result.data[0]
    logger.info(f"  Job {job_id}: 클레임 성공 — blog={job['blog_id']}, keyword={job['keyword']}")

    # blogctl로 발행
    pub_result = await publish_job(job)

    if pub_result["success"]:
        # 발행 성공
        supabase.table("publish_jobs").update({
            "status": "published",
            "published_url": pub_result["published_url"],
            "published_at": datetime.now(timezone.utc).isoformat(),
            "publish_error": None,
        }).eq("id", job_id).execute()

        # keyword status를 published로 변경
        if job.get("keyword_id"):
            supabase.table("keywords").update({
                "status": "published",
                "published_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job["keyword_id"]).eq("user_id", WORKER_USER_ID).execute()

        logger.info(f"  Job {job_id}: 발행 성공 — {pub_result['published_url']}")
    else:
        # 발행 실패
        attempts = (job.get("publish_attempts") or 0) + 1
        is_session_expired = pub_result["error_type"] == "session_expired"

        # 세션 만료는 재시도 카운트 증가시키지 않음
        if is_session_expired:
            attempts = job.get("publish_attempts") or 0

        new_status = "publish_failed" if attempts >= MAX_PUBLISH_ATTEMPTS else "publish_requested"

        supabase.table("publish_jobs").update({
            "status": new_status,
            "publish_error": pub_result["error"],
            "publish_error_type": pub_result["error_type"],
            "publish_attempts": attempts,
        }).eq("id", job_id).execute()

        level = "WARNING" if is_session_expired else "ERROR"
        logger.log(
            getattr(logging, level),
            f"  Job {job_id}: 발행 실패 (시도 {attempts}/{MAX_PUBLISH_ATTEMPTS}) — {pub_result['error']}"
        )


async def send_heartbeat():
    """워커 heartbeat 전송"""
    try:
        supabase.table("worker_heartbeats").upsert({
            "user_id": WORKER_USER_ID,
            "worker_name": "default",
            "status": "online",
            "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
            "metadata": {"platform": "windows"},
        }, on_conflict="user_id,worker_name").execute()
    except Exception as e:
        logger.warning(f"Heartbeat 전송 실패: {e}")


async def poll_pending_jobs():
    """폴링 폴백 — 미처리 publish_requested job 확인"""
    result = supabase.table("publish_jobs").select("id").eq(
        "status", "publish_requested"
    ).eq("user_id", WORKER_USER_ID).execute()

    if result.data:
        logger.info(f"폴링: {len(result.data)}개 미처리 job 발견")
        for job in result.data:
            await claim_and_process(job["id"])


async def main():
    logger.info("=" * 50)
    logger.info("BlogCtl Worker 시작")
    logger.info(f"  User ID: {WORKER_USER_ID}")
    logger.info(f"  Heartbeat: {HEARTBEAT_INTERVAL}s, Poll: {POLL_INTERVAL}s")
    logger.info("=" * 50)

    # 초기 heartbeat
    await send_heartbeat()

    # Realtime 콜백에서 asyncio 태스크 생성을 위해 루프 캡처
    loop = asyncio.get_running_loop()

    def on_realtime_change(payload):
        """Realtime 이벤트 핸들러 (별도 스레드에서 호출됨)"""
        new = payload.get("new") or payload.get("record", {})
        if not new:
            return

        if new.get("status") == "publish_requested" and new.get("user_id") == WORKER_USER_ID:
            job_id = new["id"]
            logger.info(f"Realtime: publish_requested 감지 — Job {job_id}")
            # 별도 스레드에서 호출되므로 call_soon_threadsafe 사용
            loop.call_soon_threadsafe(
                lambda jid=job_id: loop.create_task(claim_and_process(jid))
            )

    # Realtime 구독
    channel = supabase.channel("publish-jobs-worker")
    channel.on_postgres_changes(
        event="*",
        schema="public",
        table="publish_jobs",
        filter=f"user_id=eq.{WORKER_USER_ID}",
        callback=on_realtime_change,
    )
    channel.subscribe()
    logger.info("Supabase Realtime 구독 시작")

    # 시작 시 미처리 job 확인
    await poll_pending_jobs()

    # 메인 루프: heartbeat + 폴링
    heartbeat_counter = 0
    while running:
        await asyncio.sleep(1)
        heartbeat_counter += 1

        if heartbeat_counter >= HEARTBEAT_INTERVAL:
            await send_heartbeat()
            heartbeat_counter = 0

        if heartbeat_counter % POLL_INTERVAL == 0:
            await poll_pending_jobs()

    # 종료 처리
    logger.info("워커 종료 중...")
    supabase.table("worker_heartbeats").update({
        "status": "offline",
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
    }).eq("user_id", WORKER_USER_ID).eq("worker_name", "default").execute()

    supabase.remove_channel(channel)
    logger.info("워커 종료 완료")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Commit**

```bash
git add worker/main.py
git commit -m "feat: add worker main — Realtime subscription, heartbeat, polling fallback"
```

---

## Task 9: 워커 실행 테스트

- [ ] **Step 1: Python 의존성 설치**

```bash
cd worker
pip install -r requirements.txt
```

- [ ] **Step 2: .env 설정**

```bash
cp .env.example .env
# .env에 실제 값 입력:
# - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: .env.local에서 복사
# - WORKER_USER_ID: Supabase Auth에서 본인 user UUID 확인
# - BLOGCTL_PATH, BLOGCTL_CONFIG_PATH: blogctl 경로
```

- [ ] **Step 3: 워커 시작 확인**

```bash
cd worker
python main.py
```

Expected:
```
BlogCtl Worker 시작
  User ID: <uuid>
  Heartbeat: 30s, Poll: 60s
Supabase Realtime 구독 시작
```

- [ ] **Step 4: 대시보드에서 워커 상태 확인**

브라우저에서 대시보드 접속 → 헤더에 녹색 점 + "워커" 표시 확인

- [ ] **Step 5: 수동 발행 E2E 테스트**

1. 대시보드에서 블로그 선택 → 키워드로 "글 생성"
2. `/jobs/[jobId]` 페이지에서 내용 확인
3. "블로그에 발행" 버튼 클릭
4. 워커 터미널에서 `Realtime: publish_requested 감지` 로그 확인
5. 실제 블로그 플랫폼에 글이 발행되었는지 확인
6. 대시보드 job 상세에서 `발행됨` 상태 + published_url 확인

- [ ] **Step 6: Commit (최종)**

```bash
git add -A
git commit -m "feat: Phase 4 complete — browser automation worker for auto-publishing"
```

---

## 요약

| Task | 내용 | 예상 |
|------|------|------|
| 1 | DB 스키마 변경 | SQL 실행 |
| 2 | API 수정 (GPT-4o-mini, keyword 타이밍) | 2개 파일 수정 |
| 3 | 수동 발행 요청 API | 1개 파일 생성 |
| 4 | Job 상세 UI (발행 버튼 + 상태) | 2개 파일 |
| 5 | 워커 상태 배지 | 2개 파일 |
| 6 | 워커 config/requirements | 3개 파일 |
| 7 | 워커 publisher (blogctl 래퍼) | 1개 파일 |
| 8 | 워커 main (Realtime + heartbeat) | 1개 파일 |
| 9 | 통합 테스트 | E2E 검증 |
