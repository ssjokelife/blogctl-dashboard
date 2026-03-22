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

running = True


def handle_shutdown(signum, frame):
    global running
    logger.info("종료 신호 수신, 워커 종료 중...")
    running = False


signal.signal(signal.SIGINT, handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)


async def auto_index(job_id: int, url: str):
    """발행 후 자동 GSC 인덱싱 요청"""
    try:
        import httpx
        # 대시보드 API를 통하지 않고 직접 Google API 호출
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request as GoogleRequest
        import json
        import os

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
    # 원자적 클레임: publish_requested → publishing (전체 컬럼 반환)
    result = supabase.table("publish_jobs").update({
        "status": "publishing",
    }).eq("id", job_id).eq("status", "publish_requested").select("*").execute()

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
            "publish_error_type": None,
        }).eq("id", job_id).execute()

        # keyword status를 published로 변경
        if job.get("keyword_id"):
            supabase.table("keywords").update({
                "status": "published",
                "published_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job["keyword_id"]).eq("user_id", WORKER_USER_ID).execute()

        logger.info(f"  Job {job_id}: 발행 성공 — {pub_result['published_url']}")

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
    """폴링 폴백 — 미처리 publish_requested job 확인"""
    result = supabase.table("publish_jobs").select("id").eq(
        "status", "publish_requested"
    ).eq("user_id", WORKER_USER_ID).execute()

    if result.data:
        logger.info(f"폴링: {len(result.data)}개 미처리 job 발견")
        for job in result.data:
            await claim_and_process(job["id"])


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
