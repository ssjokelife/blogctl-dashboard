"""Daily Run 파이프라인 — 분석 → 계획 → 생성 → 리포트"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from config import WORKER_USER_ID, get_supabase

logger = logging.getLogger("daily_run")


def safe_query(supabase, fn, retries=2):
    """DB 쿼리 실행 + 연결 끊김 시 클라이언트 재생성하여 재시도"""
    for attempt in range(retries + 1):
        try:
            return fn(supabase)
        except Exception as e:
            err_str = str(e).lower()
            if attempt < retries and ("disconnect" in err_str or "connection" in err_str or "closed" in err_str or "timeout" in err_str):
                logger.warning(f"DB 연결 오류, 재연결 시도 ({attempt + 1}/{retries}): {e}")
                supabase = get_supabase()  # 새 클라이언트 생성
                continue
            raise
    return None  # unreachable


def log_event(supabase, run_id: str, message: str, level: str = "info"):
    """daily_run_logs에 이벤트 기록 (Realtime으로 UI에 즉시 전달)"""
    try:
        supabase.table("daily_run_logs").insert({
            "daily_run_id": run_id,
            "level": level,
            "message": message,
        }).execute()
    except Exception as e:
        logger.warning(f"로그 기록 실패: {e}")


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


def generate_ai_insights(analysis: dict) -> tuple:
    """GPT-4o 사전 분석 — 수집된 데이터에서 인사이트 도출"""
    import openai

    system_prompt = """당신은 블로그 포트폴리오 분석가입니다.
블로그 현황 데이터를 분석하여 핵심 인사이트를 도출해주세요.

분석 관점:
1. 트래픽/수익 추세 (최근 7일 vs 이전 7일)
2. 키워드풀 건강도 (대기 키워드 비율, urgent/high 비율)
3. 블로그별 성과 차이와 집중 전략
4. 수익 구조 (애드센스 vs 쿠팡)
5. 인덱싱 현황과 개선점

JSON으로 응답:
{
  "insights": [
    {"topic": "주제", "finding": "발견 사항", "action": "권장 조치"}
  ],
  "focus_blogs": ["집중해야 할 blog_id 목록"],
  "risk_alerts": ["주의가 필요한 사항"],
  "summary": "전체 현황 한 줄 요약"
}"""

    user_prompt = f"""블로그 분석 데이터:
{json.dumps(analysis, ensure_ascii=False, default=str)}"""

    tokens_used = 0
    try:
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=2000,
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        tokens_used = completion.usage.total_tokens if completion.usage else 0
        raw = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        return parsed, tokens_used

    except Exception as e:
        logger.error(f"AI 사전분석 실패: {e}")
        return {
            "insights": [],
            "focus_blogs": [],
            "risk_alerts": [f"AI 분석 실패: {str(e)[:100]}"],
            "summary": "AI 분석을 수행할 수 없어 데이터 기반 계획으로 진행합니다.",
        }, tokens_used


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


def generate_publish_plan(supabase, analysis, ai_insights=None) -> tuple:
    """GPT-4o 기반 발행 계획 생성. (plan_dict, tokens_used) 반환"""
    import openai

    # 각 블로그의 available keywords 수집
    available_keywords = {}
    for blog_id in analysis["blogs"]:
        kws = supabase.table("keywords").select("id, keyword, priority, expected_clicks_4w").eq(
            "blog_id", blog_id
        ).eq("user_id", WORKER_USER_ID).eq("status", "pending").limit(50).execute()
        available_keywords[blog_id] = kws.data or []

    insights_section = ""
    if ai_insights:
        insights_section = f"""

아래는 사전 AI 분석 결과입니다. 이 인사이트를 계획에 반영해주세요:
{json.dumps(ai_insights, ensure_ascii=False, default=str)}"""

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
{json.dumps(available_keywords, ensure_ascii=False, default=str)}{insights_section}"""

    tokens_used = 0
    try:
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=2000,
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        tokens_used = completion.usage.total_tokens if completion.usage else 0
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

        return {"blogs": blogs_plan, "total_jobs": total}, tokens_used

    except Exception as e:
        logger.error(f"GPT 발행 계획 생성 실패: {e}")
        return fallback_plan(supabase, analysis), tokens_used


def generate_report(supabase, analysis, plan, job_ids, ai_insights=None) -> tuple:
    """GPT-4o 사후분석 리포트 생성. (report, todos, tokens_used) 반환"""
    import openai

    # 결과 일괄 조회
    job_results = []
    if job_ids:
        results = supabase.table("publish_jobs").select("*").in_("id", job_ids).execute()
        job_results = results.data or []

    # 콘텐츠 생성에 사용된 총 토큰 집계
    content_tokens = sum(
        (j.get("metadata") or {}).get("tokens", 0)
        for j in job_results
    )

    insights_section = ""
    if ai_insights:
        insights_section = f"""

사전 분석 인사이트:
{json.dumps(ai_insights, ensure_ascii=False, default=str)}"""

    tokens_used = 0
    try:
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

        system_prompt = """당신은 블로그 운영 분석가입니다.
오늘의 사전분석, 계획, 실행 결과를 종합하여 **사후분석 리포트**를 작성해주세요.

리포트에 포함할 내용:
1. **실행 요약** — 계획 대비 실제 결과 (성공/실패/미발행)
2. **성과 분석** — 사전분석 인사이트가 계획에 잘 반영되었는지, 발행 품질
3. **문제점 & 개선** — 실패 원인, 반복되는 패턴, 다음 실행에서 개선할 점
4. **다음 단계** — 내일/이번 주 집중할 사항

TODO: 블로그 운영자가 직접 해야 할 작업 목록

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
{json.dumps(analysis, ensure_ascii=False, default=str)}{insights_section}

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
    "tokens": (j.get("metadata") or {}).get("tokens", 0),
    "quality_score": (j.get("metadata") or {}).get("quality_score", 0),
} for j in job_results], ensure_ascii=False, default=str)}

콘텐츠 생성 총 토큰: {content_tokens}"""

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=3000,
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        tokens_used = completion.usage.total_tokens if completion.usage else 0
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

        return report, todos, tokens_used

    except Exception as e:
        logger.error(f"GPT 리포트 생성 실패: {e}")
        # 폴백 리포트
        published = len([j for j in job_results if j.get("status") == "published"])
        completed = len([j for j in job_results if j.get("status") == "completed"])
        failed = len([j for j in job_results if j.get("status") in ("failed", "publish_failed")])

        report = f"""# Daily Run 리포트

## 요약
- 총 블로그: {analysis.get('summary', {}).get('total_blogs', 0)}개
- 생성 요청: {len(job_ids)}건
- 발행 완료: {published}건
- 콘텐츠 완료 (미발행): {completed}건
- 실패: {failed}건
- 콘텐츠 생성 토큰: {content_tokens}
"""
        return report, [], tokens_used


async def run_daily_workflow(run_id, supabase) -> None:
    """메인 파이프라인: 데이터수집 → AI사전분석 → 계획 → 생성/발행 → AI사후분석"""
    logger.info(f"Daily Run {run_id}: 워크플로우 시작")

    # 단계별 토큰 추적
    token_usage = {"analysis": 0, "plan": 0, "content": 0, "report": 0, "total": 0}

    try:
        # run 정보 조회
        run_result = supabase.table("daily_runs").select("*").eq("id", run_id).single().execute()
        run_data = run_result.data
        mode = run_data.get("mode", "auto")

        # Phase 1a: 데이터 수집
        supabase.table("daily_runs").update({
            "status": "analyzing",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()
        log_event(supabase, run_id, "📊 분석 시작 — 블로그 현황 수집 중")

        analysis = collect_analysis(supabase)
        summary = analysis.get("summary", {})
        log_event(supabase, run_id, f"📊 데이터 수집 완료 — {summary.get('total_blogs', 0)}개 블로그, 키워드 {summary.get('total_pending_keywords', 0)}개 대기")

        # Phase 1b: AI 사전분석
        log_event(supabase, run_id, "🧠 AI 사전분석 중 — 인사이트 도출...")
        ai_insights, analysis_tokens = generate_ai_insights(analysis)
        token_usage["analysis"] = analysis_tokens

        # analysis에 AI 인사이트 포함하여 저장
        analysis["ai_insights"] = ai_insights
        supabase.table("daily_runs").update({
            "analysis": analysis,
        }).eq("id", run_id).execute()

        insights_count = len(ai_insights.get("insights", []))
        alerts_count = len(ai_insights.get("risk_alerts", []))
        log_event(supabase, run_id, f"🧠 AI 분석 완료 — 인사이트 {insights_count}건, 주의사항 {alerts_count}건 ({analysis_tokens} tokens)")
        logger.info(f"Daily Run {run_id}: AI 분석 완료 — {insights_count} 인사이트")

        # Phase 2: 계획 (AI 인사이트 반영)
        log_event(supabase, run_id, "🤖 GPT-4o 발행 계획 수립 중...")
        plan, plan_tokens = generate_publish_plan(supabase, analysis, ai_insights)
        token_usage["plan"] = plan_tokens
        supabase.table("daily_runs").update({
            "plan": plan,
            "status": "plan_ready",
        }).eq("id", run_id).execute()
        log_event(supabase, run_id, f"📋 계획 완료 — {plan['total_jobs']}건 발행 예정 ({plan_tokens} tokens)")
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
                    log_event(supabase, run_id, f"📝 Job 생성: {kw['keyword']}")
                    logger.info(f"Daily Run {run_id}: Job 생성 — {kw['keyword']}")

        supabase.table("daily_runs").update({
            "status": "publishing",
        }).eq("id", run_id).execute()
        log_event(supabase, run_id, f"⚙️ {len(job_ids)}개 Job 생성 완료 — 콘텐츠 생성 시작")
        logger.info(f"Daily Run {run_id}: {len(job_ids)}개 Job 생성 완료, 콘텐츠 생성 시작")

        # 콘텐츠 생성 직접 실행 (Realtime 미작동 대비)
        from main import generate_content
        for jid in job_ids:
            try:
                claim = supabase.table("publish_jobs").update({
                    "status": "generating",
                }).eq("id", jid).eq("status", "generate_requested").execute()
                if claim.data:
                    await generate_content(jid)
            except Exception as e:
                logger.error(f"  Job {jid}: 콘텐츠 생성 실패 — {e}")
                supabase.table("publish_jobs").update({
                    "status": "failed",
                    "error_message": str(e),
                }).eq("id", jid).execute()

        # Phase 4: Job 완료 대기 (연결 끊김 대비 재연결 포함)
        timeout_hours = 4 if mode == "auto" else 24
        timeout_at = datetime.now(timezone.utc) + timedelta(hours=timeout_hours)
        terminal_auto = {"published", "publish_failed", "failed"}
        terminal_manual = {"published", "publish_failed", "failed", "completed"}
        prev_statuses = {}  # 상태 변화 감지용
        consecutive_errors = 0

        while datetime.now(timezone.utc) < timeout_at:
            await asyncio.sleep(10)

            try:
                # 연결 끊김이 반복되면 클라이언트 재생성
                if consecutive_errors >= 3:
                    logger.warning(f"Daily Run {run_id}: 연속 {consecutive_errors}회 오류, Supabase 재연결")
                    supabase = get_supabase()
                    consecutive_errors = 0

                # Run 상태 체크 (취소/종료 요청)
                run_check = supabase.table("daily_runs").select("status").eq("id", run_id).single().execute()
                current_status = run_check.data.get("status") if run_check.data else None
                if current_status in ("cancelled", "finalize_requested"):
                    log_event(supabase, run_id, f"⏹️ {current_status} 감지 — 보고 단계로 이동")
                    logger.info(f"Daily Run {run_id}: {current_status} 감지, 리포트 진행")
                    break

                # Job 상태 확인
                if not job_ids:
                    break

                jobs_check = supabase.table("publish_jobs").select("id, status, keyword, title, published_url, publish_error, publish_error_type, metadata").in_("id", job_ids).execute()
                jobs = jobs_check.data or []
                statuses = {j["id"]: j["status"] for j in jobs}

                # 상태 변화 로그
                for j in jobs:
                    jid = j["id"]
                    new_status = j["status"]
                    old_status = prev_statuses.get(jid)
                    if old_status and old_status != new_status:
                        kw = j.get("keyword", "")
                        if new_status == "generating":
                            done = sum(1 for s in statuses.values() if s not in ("generate_requested", "generating"))
                            log_event(supabase, run_id, f"⚙️ 콘텐츠 생성 중: {kw} ({done + 1}/{len(job_ids)})")
                        elif new_status == "completed":
                            meta = j.get("metadata") or {}
                            score = meta.get("quality_score", "?")
                            log_event(supabase, run_id, f"✅ 생성 완료: {kw} (품질 {score}/100)")
                        elif new_status == "publish_requested":
                            log_event(supabase, run_id, f"🚀 발행 요청: {kw}")
                        elif new_status == "publishing":
                            log_event(supabase, run_id, f"🚀 발행 중: {kw}")
                        elif new_status == "published":
                            url = j.get("published_url", "")
                            log_event(supabase, run_id, f"✅ 발행 완료: {kw} — {url}")
                        elif new_status == "failed":
                            log_event(supabase, run_id, f"❌ 생성 실패: {kw}", "error")
                        elif new_status == "publish_failed":
                            err_type = j.get("publish_error_type", "")
                            err = j.get("publish_error", "")[:80] if j.get("publish_error") else ""
                            if err_type == "session_expired":
                                log_event(supabase, run_id, f"❌ 발행 실패: {kw} — 세션 만료 (blogctl login 필요)", "error")
                            else:
                                log_event(supabase, run_id, f"❌ 발행 실패: {kw} — {err}", "error")
                prev_statuses = statuses.copy()

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
                    published = sum(1 for s in statuses.values() if s == "published")
                    failed = sum(1 for s in statuses.values() if s in ("failed", "publish_failed"))
                    log_event(supabase, run_id, f"📊 전체 완료 — 성공 {published}건, 실패 {failed}건")
                    logger.info(f"Daily Run {run_id}: 모든 Job 완료")
                    break

                consecutive_errors = 0  # 성공하면 리셋

            except Exception as poll_err:
                consecutive_errors += 1
                logger.warning(f"Daily Run {run_id}: 대기 루프 오류 ({consecutive_errors}회): {poll_err}")
                await asyncio.sleep(5)  # 짧게 대기 후 재시도
                continue
        else:
            log_event(supabase, run_id, f"⏰ 타임아웃 ({timeout_hours}시간) — 현재 결과로 보고 진행", "warning")
            logger.warning(f"Daily Run {run_id}: 타임아웃 ({timeout_hours}h)")

        # Phase 5: AI 사후분석 리포트
        supabase.table("daily_runs").update({
            "status": "reporting",
        }).eq("id", run_id).execute()
        log_event(supabase, run_id, "📝 AI 사후분석 리포트 생성 중...")

        # 콘텐츠 생성 토큰 집계
        if job_ids:
            jobs_for_tokens = supabase.table("publish_jobs").select("metadata").in_("id", job_ids).execute()
            token_usage["content"] = sum(
                (j.get("metadata") or {}).get("tokens", 0)
                for j in (jobs_for_tokens.data or [])
            )

        report, todos, report_tokens = generate_report(supabase, analysis, plan, job_ids, ai_insights)
        token_usage["report"] = report_tokens
        token_usage["total"] = sum(token_usage[k] for k in ("analysis", "plan", "content", "report"))

        # token_usage를 analysis에 저장
        analysis["token_usage"] = token_usage
        supabase.table("daily_runs").update({
            "status": "completed",
            "analysis": analysis,
            "report": report,
            "todos": todos,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()

        todo_count = len(todos) if todos else 0
        log_event(supabase, run_id, f"🎉 워크플로우 완료 — TODO {todo_count}건, 총 토큰 {token_usage['total']:,}")
        logger.info(f"Daily Run {run_id}: 워크플로우 완료 — 토큰 {token_usage}")

    except Exception as e:
        logger.error(f"Daily Run {run_id}: 워크플로우 실패 — {e}", exc_info=True)
        log_event(supabase, run_id, f"💥 워크플로우 실패 — {str(e)[:200]}", "error")
        try:
            supabase.table("daily_runs").update({
                "status": "failed",
                "error_message": str(e),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", run_id).execute()
        except Exception:
            logger.error(f"Daily Run {run_id}: 실패 상태 업데이트도 실패")


async def resume_stalled_runs(run_id: str | None, supabase):
    """중단된 daily_run 복구 — finalize_requested 처리 또는 중단된 publishing run 보고서 생성"""
    if run_id:
        # 특정 run 처리
        runs_to_resume = [{"id": run_id}]
    else:
        # publishing 상태인데 30분 이상 변경 없는 run 찾기 (워크플로우 중단 감지)
        stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
        result = supabase.table("daily_runs").select("id").eq(
            "user_id", WORKER_USER_ID
        ).in_("status", ["publishing", "finalize_requested"]).lt(
            "started_at", stale_cutoff
        ).execute()
        runs_to_resume = result.data or []

    for run_data in runs_to_resume:
        rid = run_data["id"]
        try:
            logger.info(f"Daily Run {rid}: 중단된 run 복구 — 보고서 생성")
            log_event(supabase, rid, "🔄 워크플로우 복구 — 보고서 생성 시작")

            # run 데이터 조회
            run_result = supabase.table("daily_runs").select("*").eq("id", rid).single().execute()
            run = run_result.data
            if not run:
                continue

            analysis = run.get("analysis") or {}
            plan = run.get("plan") or {}

            # 연결된 job_ids 조회
            jobs_result = supabase.table("publish_jobs").select("id").eq(
                "daily_run_id", rid
            ).execute()
            job_ids = [j["id"] for j in (jobs_result.data or [])]

            # 보고서 생성
            supabase.table("daily_runs").update({
                "status": "reporting",
            }).eq("id", rid).execute()
            log_event(supabase, rid, "📝 AI 리포트 생성 중...")

            ai_insights = (analysis.get("ai_insights")) if analysis else None
            report, todos, report_tokens = generate_report(supabase, analysis, plan, job_ids, ai_insights)

            supabase.table("daily_runs").update({
                "status": "completed",
                "report": report,
                "todos": todos,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", rid).execute()

            todo_count = len(todos) if todos else 0
            log_event(supabase, rid, f"🎉 워크플로우 완료 — TODO {todo_count}건 ({report_tokens} tokens)")
            logger.info(f"Daily Run {rid}: 복구 완료")

        except Exception as e:
            logger.error(f"Daily Run {rid}: 복구 실패 — {e}")
            log_event(supabase, rid, f"💥 복구 실패 — {str(e)[:200]}", "error")
