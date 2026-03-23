"""Daily Run 파이프라인 — 분석 → 계획 → 생성 → 리포트"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from config import WORKER_USER_ID

logger = logging.getLogger("daily_run")


def collect_analysis(supabase) -> dict:
    """블로그 분석 데이터 수집"""
    now = datetime.now(timezone.utc)
    fourteen_days_ago = (now - timedelta(days=14)).isoformat()
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    # 블로그 조회
    blogs_result = supabase.table("blogs").select("*").eq(
        "user_id", WORKER_USER_ID
    ).execute()
    blogs = blogs_result.data or []

    # 측정 데이터 (14일) — 컬럼명: measured_at
    measurements_result = supabase.table("measurements").select("*").eq(
        "user_id", WORKER_USER_ID
    ).gte("measured_at", fourteen_days_ago[:10]).execute()
    measurements = measurements_result.data or []

    # 키워드
    keywords_result = supabase.table("keywords").select("*").eq(
        "user_id", WORKER_USER_ID
    ).execute()
    all_keywords = keywords_result.data or []

    # 최근 7일 발행 jobs
    jobs_result = supabase.table("publish_jobs").select("*").eq(
        "user_id", WORKER_USER_ID
    ).gte("created_at", seven_days_ago).execute()
    recent_jobs = jobs_result.data or []

    # 측정 데이터를 날짜 기준으로 분류 (최근 7일 vs 이전 7일)
    seven_days_ago_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    recent_measurements = [m for m in measurements if m.get("measured_at", "") >= seven_days_ago_date]
    prev_measurements = [m for m in measurements if m.get("measured_at", "") < seven_days_ago_date]

    # 수익 집계
    def sum_revenue(mlist):
        total = 0
        for m in mlist:
            data = m.get("data") or {}
            adsense = data.get("adsense") or {}
            coupang = data.get("coupang") or {}
            total += adsense.get("revenue", 0) or 0
            total += coupang.get("revenue", 0) or 0
        return total

    def sum_coupang_clicks(mlist):
        total = 0
        for m in mlist:
            data = m.get("data") or {}
            coupang = data.get("coupang") or {}
            total += coupang.get("clicks", 0) or 0
        return total

    # 트래픽 집계 (graceful degradation)
    def sum_pageviews(mlist):
        total = 0
        has_data = False
        for m in mlist:
            data = m.get("data") or {}
            adsense = data.get("adsense") or {}
            pv = adsense.get("pageviews")
            if pv is not None:
                total += pv
                has_data = True
        return total if has_data else None

    recent_revenue = sum_revenue(recent_measurements)
    prev_revenue = sum_revenue(prev_measurements)
    recent_clicks = sum_coupang_clicks(recent_measurements)
    prev_clicks = sum_coupang_clicks(prev_measurements)
    recent_traffic = sum_pageviews(recent_measurements)
    prev_traffic = sum_pageviews(prev_measurements)

    # 블로그별 분석
    blogs_analysis = {}
    total_pending = 0
    for blog in blogs:
        blog_id = blog["id"]
        blog_keywords = [k for k in all_keywords if k.get("blog_id") == blog_id]
        blog_jobs = [j for j in recent_jobs if j.get("blog_id") == blog_id]

        kw_total = len(blog_keywords)
        kw_pending = len([k for k in blog_keywords if k.get("status") == "pending"])
        kw_published = len([k for k in blog_keywords if k.get("status") == "published"])
        kw_urgent = len([k for k in blog_keywords if k.get("priority") == "urgent"])
        kw_high = len([k for k in blog_keywords if k.get("priority") == "high"])

        total_pending += kw_pending

        # 최근 포스트 수
        recent_posts = len([j for j in blog_jobs if j.get("status") in ("published", "completed")])

        # 인덱싱 비율
        published_jobs = [j for j in blog_jobs if j.get("status") == "published"]
        indexed_jobs = [j for j in published_jobs if j.get("index_status") == "requested"]
        indexing_rate = (len(indexed_jobs) / len(published_jobs) * 100) if published_jobs else None

        blogs_analysis[blog_id] = {
            "label": blog.get("label") or blog.get("name", ""),
            "url": blog.get("url", ""),
            "traffic": recent_traffic,
            "revenue": {
                "recent_7d": recent_revenue,
                "prev_7d": prev_revenue,
                "coupang_clicks_recent": recent_clicks,
                "coupang_clicks_prev": prev_clicks,
            },
            "keywords": {
                "total": kw_total,
                "pending": kw_pending,
                "published": kw_published,
                "urgent": kw_urgent,
                "high": kw_high,
            },
            "recent_posts": recent_posts,
            "indexing": indexing_rate,
        }

    return {
        "blogs": blogs_analysis,
        "summary": {
            "total_blogs": len(blogs),
            "total_pending_keywords": total_pending,
            "weekly_revenue": recent_revenue,
            "data_available": len(measurements) > 0,
        },
    }


def select_top_keywords(supabase, blog_id, count) -> list:
    """우선순위 기반 키워드 선택"""
    result = supabase.table("keywords").select("*").eq(
        "blog_id", blog_id
    ).eq("user_id", WORKER_USER_ID).eq(
        "status", "pending"
    ).limit(100).execute()

    keywords = result.data or []
    priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    sorted_kw = sorted(keywords, key=lambda k: (
        priority_order.get(k.get("priority", "medium"), 2),
        -(k.get("expected_clicks_4w") or 0),
    ))
    return sorted_kw[:count]


def fallback_plan(supabase, analysis) -> dict:
    """GPT 실패 시 기본 플랜: 블로그당 1건"""
    blogs_plan = {}
    total = 0
    for blog_id, info in analysis["blogs"].items():
        if info["keywords"]["pending"] == 0:
            blogs_plan[blog_id] = {
                "recommended_count": 0,
                "reason": "대기 키워드 없음",
                "keywords": [],
            }
            continue

        top_kw = select_top_keywords(supabase, blog_id, 1)
        blogs_plan[blog_id] = {
            "recommended_count": 1,
            "reason": "폴백 플랜 — GPT 응답 실패로 블로그당 1건 기본 배정",
            "keywords": [{"id": k["id"], "keyword": k["keyword"], "priority": k.get("priority", "medium")} for k in top_kw],
        }
        total += len(top_kw)

    return {"blogs": blogs_plan, "total_jobs": total}


def generate_publish_plan(supabase, analysis) -> dict:
    """GPT-4o 기반 발행 계획 생성"""
    import openai

    # 각 블로그의 available keywords 수집
    available_keywords = {}
    for blog_id in analysis["blogs"]:
        kws = supabase.table("keywords").select("id, keyword, priority, expected_clicks_4w").eq(
            "blog_id", blog_id
        ).eq("user_id", WORKER_USER_ID).eq("status", "pending").limit(50).execute()
        available_keywords[blog_id] = kws.data or []

    system_prompt = """당신은 블로그 운영 전략가입니다.
블로그 분석 데이터와 사용 가능한 키워드를 보고, 오늘의 발행 계획을 세워주세요.

규칙:
- 집중 블로그 (키워드 풀이 크고 수익이 좋은): 2-3개 포스트
- 일반 블로그: 1개 포스트
- 키워드 풀이 적은 블로그 (5개 미만): 0-1개
- urgent/high 우선순위 키워드를 우선 선택
- expected_clicks_4w가 높은 키워드 우선

반드시 JSON으로 응답:
{
  "blogs": {
    "<blog_id>": {
      "recommended_count": N,
      "reason": "이유 설명",
      "keyword_ids": [id1, id2, ...]
    }
  }
}"""

    user_prompt = f"""분석 데이터:
{json.dumps(analysis, ensure_ascii=False, default=str)}

사용 가능한 키워드:
{json.dumps(available_keywords, ensure_ascii=False, default=str)}"""

    try:
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=2000,
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        raw = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw)

        # keyword_ids → 실제 키워드 검증 + 매핑
        valid_kw_ids = {}
        for blog_id, kws in available_keywords.items():
            valid_kw_ids[blog_id] = {k["id"]: k for k in kws}

        blogs_plan = {}
        total = 0
        for blog_id, plan_data in parsed.get("blogs", {}).items():
            gpt_ids = plan_data.get("keyword_ids", [])
            valid_ids = valid_kw_ids.get(blog_id, {})

            # GPT가 제안한 ID 중 실제 존재하는 것만 필터
            validated_keywords = []
            for kid in gpt_ids:
                if kid in valid_ids:
                    k = valid_ids[kid]
                    validated_keywords.append({
                        "id": k["id"],
                        "keyword": k["keyword"],
                        "priority": k.get("priority", "medium"),
                    })

            # GPT가 hallucinated IDs만 줬으면 fallback으로 채움
            recommended = plan_data.get("recommended_count", len(validated_keywords))
            if recommended > 0 and not validated_keywords:
                top_kw = select_top_keywords(supabase, blog_id, recommended)
                validated_keywords = [{"id": k["id"], "keyword": k["keyword"], "priority": k.get("priority", "medium")} for k in top_kw]

            blogs_plan[blog_id] = {
                "recommended_count": recommended,
                "reason": plan_data.get("reason", ""),
                "keywords": validated_keywords[:recommended],
            }
            total += len(blogs_plan[blog_id]["keywords"])

        return {"blogs": blogs_plan, "total_jobs": total}

    except Exception as e:
        logger.error(f"GPT 발행 계획 생성 실패: {e}")
        return fallback_plan(supabase, analysis)


def generate_report(supabase, analysis, plan, job_ids) -> tuple:
    """GPT-4o 리포트 생성"""
    import openai

    # 결과 일괄 조회
    job_results = []
    if job_ids:
        results = supabase.table("publish_jobs").select("*").in_("id", job_ids).execute()
        job_results = results.data or []

    try:
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

        system_prompt = """당신은 블로그 운영 리포트 작성자입니다.
오늘의 분석, 계획, 실행 결과를 보고 마크다운 리포트와 TODO를 작성해주세요.

리포트: 오늘의 실행 요약, 성과, 개선점을 포함한 마크다운
TODO: 블로그 운영자가 해야 할 작업 목록

JSON으로 응답:
{
  "report": "마크다운 리포트",
  "todos": [
    {
      "type": "action_type",
      "priority": "high|medium|low",
      "blog_id": "관련 블로그 ID 또는 null",
      "title": "작업 제목",
      "reason": "이유"
    }
  ]
}"""

        user_prompt = f"""분석:
{json.dumps(analysis, ensure_ascii=False, default=str)}

계획:
{json.dumps(plan, ensure_ascii=False, default=str)}

실행 결과:
{json.dumps([{
    "id": j["id"],
    "blog_id": j.get("blog_id"),
    "keyword": j.get("keyword"),
    "status": j.get("status"),
    "title": j.get("title"),
    "published_url": j.get("published_url"),
    "publish_error": j.get("publish_error"),
} for j in job_results], ensure_ascii=False, default=str)}"""

        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=3000,
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        raw = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw)

        report = parsed.get("report", "리포트 생성 실패")
        todos_raw = parsed.get("todos", [])

        # todos 포맷 정리
        todos = []
        for i, t in enumerate(todos_raw):
            todos.append({
                "id": i + 1,
                "type": t.get("type", "task"),
                "priority": t.get("priority", "medium"),
                "blog_id": t.get("blog_id"),
                "title": t.get("title", ""),
                "reason": t.get("reason", ""),
                "done": False,
            })

        return report, todos

    except Exception as e:
        logger.error(f"GPT 리포트 생성 실패: {e}")
        # 폴백 리포트
        published = len([j for j in job_results if j.get("status") == "published"])
        completed = len([j for j in job_results if j.get("status") == "completed"])
        failed = len([j for j in job_results if j.get("status") in ("failed", "publish_failed")])

        report = f"""# Daily Run 리포트

## 요약
- 총 블로그: {analysis['summary']['total_blogs']}개
- 생성 요청: {len(job_ids)}건
- 발행 완료: {published}건
- 콘텐츠 완료 (미발행): {completed}건
- 실패: {failed}건
- 주간 수익: {analysis['summary']['weekly_revenue']}원
"""
        return report, []


async def run_daily_workflow(run_id, supabase) -> None:
    """메인 3단계 파이프라인: 분석 → 계획 → 생성 → 대기 → 리포트"""
    logger.info(f"Daily Run {run_id}: 워크플로우 시작")

    try:
        # run 정보 조회
        run_result = supabase.table("daily_runs").select("*").eq("id", run_id).single().execute()
        run_data = run_result.data
        mode = run_data.get("mode", "auto")

        # Phase 1: 분석
        supabase.table("daily_runs").update({
            "status": "analyzing",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()

        analysis = collect_analysis(supabase)
        supabase.table("daily_runs").update({
            "analysis": analysis,
        }).eq("id", run_id).execute()
        logger.info(f"Daily Run {run_id}: 분석 완료 — {analysis['summary']['total_blogs']}개 블로그")

        # Phase 2: 계획
        plan = generate_publish_plan(supabase, analysis)
        supabase.table("daily_runs").update({
            "plan": plan,
            "status": "plan_ready",
        }).eq("id", run_id).execute()
        logger.info(f"Daily Run {run_id}: 계획 완료 — {plan['total_jobs']}건 예정")

        # Phase 3: Job 생성
        job_ids = []
        for blog_id, blog_plan in plan.get("blogs", {}).items():
            for kw in blog_plan.get("keywords", []):
                # 키워드 상태 변경
                supabase.table("keywords").update({
                    "status": "generating",
                }).eq("id", kw["id"]).execute()

                # Job 생성
                job_result = supabase.table("publish_jobs").insert({
                    "user_id": WORKER_USER_ID,
                    "blog_id": blog_id,
                    "keyword_id": kw["id"],
                    "keyword": kw["keyword"],
                    "status": "generate_requested",
                    "daily_run_id": run_id,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }).execute()

                if job_result.data:
                    job_ids.append(job_result.data[0]["id"])
                    logger.info(f"Daily Run {run_id}: Job 생성 — {kw['keyword']}")

        supabase.table("daily_runs").update({
            "status": "publishing",
        }).eq("id", run_id).execute()
        logger.info(f"Daily Run {run_id}: {len(job_ids)}개 Job 생성 완료, 대기 시작")

        # Phase 4: Job 완료 대기
        timeout_hours = 4 if mode == "auto" else 24
        timeout_at = datetime.now(timezone.utc) + timedelta(hours=timeout_hours)
        terminal_auto = {"published", "publish_failed", "failed"}
        terminal_manual = {"published", "publish_failed", "failed", "completed"}

        while datetime.now(timezone.utc) < timeout_at:
            await asyncio.sleep(10)

            # Run 상태 체크 (취소/종료 요청)
            run_check = supabase.table("daily_runs").select("status").eq("id", run_id).single().execute()
            current_status = run_check.data.get("status") if run_check.data else None
            if current_status in ("cancelled", "finalize_requested"):
                logger.info(f"Daily Run {run_id}: {current_status} 감지, 리포트 진행")
                break

            # Job 상태 확인
            if not job_ids:
                break

            jobs_check = supabase.table("publish_jobs").select("id, status").in_("id", job_ids).execute()
            jobs = jobs_check.data or []
            statuses = {j["id"]: j["status"] for j in jobs}

            # Auto 모드: completed → publish_requested 자동 전환
            if mode == "auto":
                for j in jobs:
                    if j["status"] == "completed":
                        supabase.table("publish_jobs").update({
                            "status": "publish_requested",
                        }).eq("id", j["id"]).execute()
                        logger.info(f"Daily Run {run_id}: Job {j['id']} → publish_requested")

            # 종료 조건 체크
            terminal = terminal_auto if mode == "auto" else terminal_manual
            if all(s in terminal for s in statuses.values()):
                logger.info(f"Daily Run {run_id}: 모든 Job 완료")
                break
        else:
            logger.warning(f"Daily Run {run_id}: 타임아웃 ({timeout_hours}h)")

        # Phase 5: 리포트
        supabase.table("daily_runs").update({
            "status": "reporting",
        }).eq("id", run_id).execute()

        report, todos = generate_report(supabase, analysis, plan, job_ids)
        supabase.table("daily_runs").update({
            "status": "completed",
            "report": report,
            "todos": todos,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()

        logger.info(f"Daily Run {run_id}: 워크플로우 완료")

    except Exception as e:
        logger.error(f"Daily Run {run_id}: 워크플로우 실패 — {e}", exc_info=True)
        try:
            supabase.table("daily_runs").update({
                "status": "failed",
                "error_message": str(e),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", run_id).execute()
        except Exception:
            logger.error(f"Daily Run {run_id}: 실패 상태 업데이트도 실패")
