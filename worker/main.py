"""BlogCtl Worker — Supabase Realtime 기반 자동 발행 + 콘텐츠 생성 워커"""
import asyncio
import logging
import signal
import os
import json
import re
from datetime import datetime, timezone

from config import (
    get_supabase, get_async_supabase, WORKER_USER_ID, HEARTBEAT_INTERVAL,
    POLL_INTERVAL, MAX_PUBLISH_ATTEMPTS,
)
from publisher import publish_job
from daily_run import run_daily_workflow

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("worker")

running = True


def handle_shutdown(signum, frame):
    global running
    logger.info("종료 신호 수신, 워커 종료 중...")
    running = False


signal.signal(signal.SIGINT, handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)


async def generate_content(job_id: int):
    """GPT-4o-mini로 콘텐츠 생성 + 품질 검증"""
    import openai

    # job 데이터 조회
    job_result = supabase.table("publish_jobs").select("*").eq("id", job_id).single().execute()
    job = job_result.data

    # blog 데이터 조회
    blog_result = supabase.table("blogs").select("*").eq("id", job["blog_id"]).single().execute()
    blog = blog_result.data

    keyword = job["keyword"]
    persona = blog.get("persona", "블로거")
    style = blog.get("style", "professional")
    ending_form = blog.get("ending_form", "~합니다")
    target_audience = blog.get("target_audience", "일반 독자")
    description = blog.get("description", "")
    categories = ", ".join(blog.get("categories", []))
    adapter = blog.get("adapter", "keyword")
    voice = blog.get("voice") or {}

    # 검색 의도 감지
    if re.search(r'비교|vs|차이|어떤게|뭐가 더', keyword):
        intent_instruction = '비교 분석형: 비교 기준 제시 → 항목별 비교 표 → 장단점 → 추천 결론 구조로 작성'
    elif re.search(r'추천|순위|TOP|베스트|인기', keyword):
        intent_instruction = '추천/구매가이드형: 선정 기준 → 순위별 소개 → 각 항목 장단점 → 최종 추천 구조로 작성'
    elif re.search(r'사이트|공식|홈페이지|로그인', keyword):
        intent_instruction = '안내형: 핵심 정보 요약 → 단계별 가이드 → FAQ → 관련 링크 구조로 작성'
    else:
        intent_instruction = '정보 제공형: 개념 설명 → 상세 분석 → 실용적 팁 → 요약 구조로 작성'

    # 보이스 지시
    voice_instructions = ""
    if voice.get("perspective"):
        voice_instructions = f"""
## 글쓰기 관점 & 목소리
- 관점: {voice.get('perspective', '')}
- 의견 스타일: {voice.get('opinion_style', '분석적')}
- 감정 범위: {', '.join(voice.get('emotional_range', []))}
- 자주 쓰는 표현: {', '.join(voice.get('catchphrases', []))}
- 최소 {voice.get('min_opinions', 2)}개 이상의 개인 의견/판단을 포함
"""

    # 쿠팡 어필리에이트
    affiliate = ""
    if adapter == "coupang":
        affiliate = """
## 쿠팡 파트너스 콘텐츠 규칙
1. 제품 리뷰/비교 형식으로 작성
2. 제품의 장단점을 객관적으로 설명
3. "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다" 문구를 글 마지막에 포함
"""

    system_prompt = f'''당신은 "{persona}"입니다.
{description}

## 블로그 설정
- 타겟 독자: {target_audience}
- 글 스타일: {style}
- 말투: {ending_form}
- 카테고리: {categories}
- 콘텐츠 구조: {intent_instruction}

## 작성 규칙
1. HTML 형식으로 작성 (전체 페이지가 아닌 본문 콘텐츠만)
2. h2, h3 태그로 구조화
3. 최소 2000자 이상 (한국어 기준)
4. 핵심 키워드를 자연스럽게 3-5회 포함
5. 독자에게 실용적인 정보 제공
6. 마지막에 정리/요약 섹션 포함
7. <p>, <ul>, <ol>, <strong>, <em> 태그 활용
{voice_instructions}{affiliate}'''

    user_prompt = f'''다음 키워드로 블로그 글을 작성해주세요.

키워드: {keyword}

다음 JSON 형식으로 응답해주세요:
{{
  "title": "SEO에 최적화된 블로그 제목",
  "html": "HTML 본문 (h2/h3 구조화, <p>, <ul> 등 사용)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "meta_description": "검색 결과에 표시될 150자 이내 요약"
}}'''

    client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    max_retries = 2
    final_html = ""
    final_title = ""
    final_tags = []
    final_meta = ""
    total_tokens = 0
    quality_score = 0
    quality_passed = False
    suggestions = []

    for attempt in range(max_retries + 1):
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt if attempt == 0 else user_prompt + f"\n\n[개선 피드백]\n이전 콘텐츠의 품질이 부족했습니다. 다음 사항을 개선해주세요:\n" + "\n".join(suggestions)}
        ]

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=4000,
            temperature=0.7,
            response_format={"type": "json_object"},
        )

        raw = completion.choices[0].message.content or "{}"
        total_tokens += completion.usage.total_tokens if completion.usage else 0

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"html": raw, "title": keyword, "tags": [], "meta_description": ""}

        final_title = parsed.get("title", keyword)
        final_html = parsed.get("html", raw)
        final_tags = parsed.get("tags", [])
        final_meta = parsed.get("meta_description", "")

        # 간단한 품질 검증
        text_content = re.sub(r'<[^>]+>', '', final_html).strip()
        char_count = len(text_content)
        h2_count = len(re.findall(r'<h2', final_html, re.I))
        keyword_count = text_content.lower().count(keyword.lower())

        score = 0
        suggestions = []
        if char_count >= 2000: score += 30
        elif char_count >= 1500: score += 20
        else:
            score += 10
            suggestions.append(f"현재 {char_count}자 — 최소 2000자 이상 권장")

        if h2_count >= 3: score += 20
        elif h2_count >= 2: score += 15
        else:
            score += 5
            suggestions.append(f"H2 {h2_count}개 — 3개 이상 권장")

        if keyword_count >= 3: score += 20
        elif keyword_count >= 1: score += 10
        else:
            score += 5
            suggestions.append(f"키워드 '{keyword}' {keyword_count}회 — 3~5회 권장")

        if len(re.findall(r'<(ul|ol)', final_html, re.I)) >= 1: score += 15
        else: suggestions.append("목록(ul/ol) 사용 권장")

        if re.search(r'(마무리|정리|요약|결론)', final_html): score += 15
        else: suggestions.append("마무리/요약 섹션 추가 권장")

        quality_score = score
        threshold = 70 if adapter == "coupang" else 75
        quality_passed = quality_score >= threshold

        if quality_passed:
            logger.info(f"  Job {job_id}: 품질 {quality_score}/100 PASS (시도 {attempt + 1})")
            break
        else:
            logger.info(f"  Job {job_id}: 품질 {quality_score}/100 FAIL (시도 {attempt + 1})")

    # HTML 간단 후처리
    current_year = str(datetime.now().year)
    # 외부 링크 target blank
    final_html = re.sub(
        r'<a\s+href="(https?://[^"]*)"(?![^>]*target=)',
        r'<a href="\1" target="_blank" rel="noopener noreferrer"',
        final_html
    )
    # 빈 태그 제거
    final_html = re.sub(r'<(p|div|span)>\s*</\1>', '', final_html)
    # 연도 업데이트
    for year in range(2020, int(current_year) - 1):
        final_html = final_html.replace(f"{year}년", f"{current_year}년")

    # 내부 링크 추가
    blog_url = blog.get("url", "")
    if blog_url and blog_url.count("://") == 0:
        if blog.get("platform") == "naver":
            blog_url = f"https://blog.naver.com/{blog_url}"
        elif "." in blog_url:
            blog_url = f"https://{blog_url}"
        else:
            blog_url = f"https://{blog_url}.tistory.com"
    if blog_url and final_html.count(blog_url) < 2:
        link_block = f'<p style="margin-top:2em;padding:1em;background:#f8f9fa;border-radius:8px;font-size:0.9em"><strong>관련 글 더 보기</strong><br><a href="{blog_url}" target="_blank" rel="noopener noreferrer">{blog_url.replace("https://", "")} 블로그 홈</a></p>'
        final_html += link_block

    # job 업데이트
    supabase.table("publish_jobs").update({
        "status": "completed",
        "title": final_title,
        "content_html": final_html,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "title": final_title,
            "tags": final_tags,
            "meta_description": final_meta,
            "model": "gpt-4o-mini",
            "tokens": total_tokens,
            "quality_score": quality_score,
            "quality_passed": quality_passed,
        },
    }).eq("id", job_id).execute()

    logger.info(f"  Job {job_id}: 콘텐츠 생성 완료 — {final_title} ({total_tokens} tokens, 품질 {quality_score}/100)")


async def auto_index(job_id: int, url: str):
    """발행 후 자동 GSC 인덱싱 요청"""
    try:
        import httpx
        # 대시보드 API를 통하지 않고 직접 Google API 호출
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request as GoogleRequest

        key_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
        if not key_json:
            logger.info(f"  Job {job_id}: GSC 인덱싱 건너뜀 (GOOGLE_SERVICE_ACCOUNT_KEY 미설정)")
            return

        credentials = service_account.Credentials.from_service_account_info(
            json.loads(key_json),
            scopes=["https://www.googleapis.com/auth/indexing"],
        )
        credentials.refresh(GoogleRequest())

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://indexing.googleapis.com/v3/urlNotifications:publish",
                headers={
                    "Authorization": f"Bearer {credentials.token}",
                    "Content-Type": "application/json",
                },
                json={"url": url, "type": "URL_UPDATED"},
            )

        if response.status_code == 200:
            supabase.table("publish_jobs").update({
                "index_status": "requested",
                "indexed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            logger.info(f"  Job {job_id}: GSC 인덱싱 요청 완료 — {url}")
        else:
            logger.warning(f"  Job {job_id}: GSC 인덱싱 실패 — {response.status_code}: {response.text}")
            supabase.table("publish_jobs").update({
                "index_status": "failed",
            }).eq("id", job_id).execute()

    except Exception as e:
        logger.warning(f"  Job {job_id}: GSC 인덱싱 오류 — {e}")


async def claim_and_process(job_id: int):
    """원자적 클레임 + 발행 처리"""
    # 원자적 클레임: publish_requested → publishing
    claim_result = supabase.table("publish_jobs").update({
        "status": "publishing",
    }).eq("id", job_id).eq("status", "publish_requested").execute()

    if not claim_result.data:
        logger.info(f"  Job {job_id}: 이미 다른 워커가 처리 중, skip")
        return

    # 전체 데이터 조회
    job_result = supabase.table("publish_jobs").select("*").eq("id", job_id).single().execute()
    job = job_result.data
    logger.info(f"  Job {job_id}: 클레임 성공 — blog={job['blog_id']}, keyword={job['keyword']}")

    # blogctl로 발행
    pub_result = await publish_job(job)

    if pub_result["success"]:
        # SNS 공유 결과 추출
        results = pub_result.get("results", {})
        sns_status = {}
        if results.get("linkedin") is not None:
            sns_status["linkedin"] = "shared" if results["linkedin"] else "failed"
        if results.get("twitter") is not None:
            sns_status["twitter"] = "shared" if results["twitter"] else "failed"

        update_data = {
            "status": "published",
            "published_url": pub_result["published_url"],
            "published_at": datetime.now(timezone.utc).isoformat(),
            "publish_error": None,
            "publish_error_type": None,
        }
        if sns_status:
            update_data["sns_status"] = sns_status
            update_data["sns_shared_at"] = datetime.now(timezone.utc).isoformat()

        supabase.table("publish_jobs").update(update_data).eq("id", job_id).execute()

        # keyword status를 published로 변경
        if job.get("keyword_id"):
            supabase.table("keywords").update({
                "status": "published",
                "published_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job["keyword_id"]).eq("user_id", WORKER_USER_ID).execute()

        logger.info(f"  Job {job_id}: 발행 성공 — {pub_result['published_url']}")
        if sns_status:
            logger.info(f"  Job {job_id}: SNS 공유 — {sns_status}")

        # GSC 자동 인덱싱 요청
        if pub_result["published_url"]:
            await auto_index(job_id, pub_result["published_url"])
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
    """폴링 — 미처리 job 확인"""
    # 콘텐츠 생성 요청
    gen_result = supabase.table("publish_jobs").select("id").eq(
        "status", "generate_requested"
    ).eq("user_id", WORKER_USER_ID).execute()

    if gen_result.data:
        logger.info(f"폴링: {len(gen_result.data)}개 콘텐츠 생성 job 발견")
        for job in gen_result.data:
            try:
                # 상태를 generating으로 변경 (중복 방지)
                claim = supabase.table("publish_jobs").update({
                    "status": "generating",
                }).eq("id", job["id"]).eq("status", "generate_requested").execute()
                if claim.data:
                    await generate_content(job["id"])
            except Exception as e:
                logger.error(f"  Job {job['id']}: 콘텐츠 생성 실패 — {e}")
                supabase.table("publish_jobs").update({
                    "status": "failed",
                    "error_message": str(e),
                }).eq("id", job["id"]).execute()

    # 발행 요청
    pub_result = supabase.table("publish_jobs").select("id").eq(
        "status", "publish_requested"
    ).eq("user_id", WORKER_USER_ID).execute()

    if pub_result.data:
        logger.info(f"폴링: {len(pub_result.data)}개 발행 job 발견")
        for job in pub_result.data:
            await claim_and_process(job["id"])


async def scheduled_publish():
    """자동 발행 — daily run 워크플로우 실행"""
    logger.info("=== 자동 발행 스케줄 시작 (Daily Run) ===")
    run_result = supabase.table("daily_runs").insert({
        "user_id": WORKER_USER_ID,
        "status": "pending",
        "mode": "auto",
        "trigger_type": "scheduled",
    }).execute()
    if run_result.data:
        run_id = run_result.data[0]["id"]
        await run_daily_workflow(run_id, supabase)
    else:
        logger.error("Daily Run 생성 실패")
    logger.info("=== 자동 발행 스케줄 완료 ===")


async def main():
    global supabase
    supabase = get_supabase()

    logger.info("=" * 50)
    logger.info("BlogCtl Worker 시작")
    logger.info(f"  User ID: {WORKER_USER_ID}")
    logger.info(f"  Heartbeat: {HEARTBEAT_INTERVAL}s, Poll: {POLL_INTERVAL}s")
    logger.info("=" * 50)

    # 초기 heartbeat
    await send_heartbeat()

    # Realtime 구독 시도 (실패 시 폴링으로 폴백)
    realtime_ok = False
    async_supabase = None
    channel = None
    daily_channel = None
    try:
        async_supabase = await get_async_supabase()
        loop = asyncio.get_running_loop()

        def on_realtime_change(payload):
            new = payload.get("new") or payload.get("record", {})
            if not new:
                return
            if new.get("user_id") != WORKER_USER_ID:
                return
            if new.get("status") == "publish_requested":
                job_id = new["id"]
                logger.info(f"Realtime: publish_requested 감지 — Job {job_id}")
                loop.call_soon_threadsafe(
                    lambda jid=job_id: loop.create_task(claim_and_process(jid))
                )
            elif new.get("status") == "generate_requested":
                job_id = new["id"]
                logger.info(f"Realtime: generate_requested 감지 — Job {job_id}")
                async def handle_generate(jid):
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
                loop.call_soon_threadsafe(
                    lambda jid=job_id: loop.create_task(handle_generate(jid))
                )

        channel = async_supabase.channel("publish-jobs-worker")
        channel.on_postgres_changes(
            event="*",
            schema="public",
            table="publish_jobs",
            filter=f"user_id=eq.{WORKER_USER_ID}",
            callback=on_realtime_change,
        )
        await channel.subscribe()
        realtime_ok = True
        logger.info("Supabase Realtime 구독 시작")

        # daily_runs 구독
        daily_channel = async_supabase.channel("daily-runs-worker")
        daily_channel.on_postgres_changes(
            event="INSERT",
            schema="public",
            table="daily_runs",
            filter=f"user_id=eq.{WORKER_USER_ID}",
            callback=lambda payload: (
                loop.call_soon_threadsafe(
                    lambda rid=payload["new"]["id"]: loop.create_task(
                        run_daily_workflow(rid, supabase)
                    )
                ) if payload.get("new", {}).get("status") == "pending" else None
            ),
        )
        await daily_channel.subscribe()
        logger.info("Daily Runs Realtime 구독 시작")
    except Exception as e:
        logger.warning(f"Realtime 구독 실패, 폴링 모드로 동작 — {e}")
        realtime_ok = False

    # 시작 시 미처리 job 확인
    await poll_pending_jobs()

    # 메인 루프: heartbeat + 폴링 (별도 카운터)
    heartbeat_counter = 0
    poll_counter = 0
    while running:
        await asyncio.sleep(1)
        heartbeat_counter += 1
        poll_counter += 1

        if heartbeat_counter >= HEARTBEAT_INTERVAL:
            await send_heartbeat()
            heartbeat_counter = 0

        if poll_counter >= POLL_INTERVAL:
            await poll_pending_jobs()
            poll_counter = 0

        # 스케줄 체크 (매일 10:00 KST = 01:00 UTC)
        now = datetime.now(timezone.utc)
        if now.hour == 1 and now.minute == 0 and heartbeat_counter == 0:
            await scheduled_publish()

    # 종료 처리
    logger.info("워커 종료 중...")
    supabase.table("worker_heartbeats").update({
        "status": "offline",
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
    }).eq("user_id", WORKER_USER_ID).eq("worker_name", "default").execute()

    if async_supabase:
        for ch in [channel, daily_channel]:
            if ch:
                try:
                    await async_supabase.remove_channel(ch)
                except Exception:
                    pass
    logger.info("워커 종료 완료")


if __name__ == "__main__":
    asyncio.run(main())
