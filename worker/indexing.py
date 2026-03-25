"""Google Indexing API — OAuth 기반 URL 인덱싱 요청"""
import os
import json
import logging
from pathlib import Path
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("worker.indexing")

TOKEN_PATH = Path(__file__).parent / ".google_token.json"
SCOPES = ["https://www.googleapis.com/auth/indexing"]


def _get_credentials():
    """OAuth 자격증명 반환 (refresh token 기반)"""
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None

    # 저장된 토큰 로드
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    # 토큰이 없거나 만료된 경우
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
        else:
            # 최초 인증 — 브라우저에서 로그인 필요
            client_config = {
                "installed": {
                    "client_id": os.environ["GOOGLE_CLIENT_ID"],
                    "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["http://localhost:0"],
                }
            }
            flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
            creds = flow.run_local_server(port=0)

        # 토큰 저장
        TOKEN_PATH.write_text(creds.to_json())
        logger.info("Google OAuth 토큰 저장 완료")

    return creds


def request_indexing(url: str) -> dict:
    """단일 URL 인덱싱 요청"""
    creds = _get_credentials()

    with httpx.Client() as client:
        resp = client.post(
            "https://indexing.googleapis.com/v3/urlNotifications:publish",
            headers={
                "Authorization": f"Bearer {creds.token}",
                "Content-Type": "application/json",
            },
            json={"url": url, "type": "URL_UPDATED"},
        )

    if resp.status_code == 200:
        return {"success": True, "url": url}
    else:
        return {"success": False, "url": url, "error": resp.text[:200]}


def batch_index(urls: list[str]) -> dict:
    """여러 URL 일괄 인덱싱 요청"""
    creds = _get_credentials()
    success = 0
    failed = 0
    results = []

    with httpx.Client() as client:
        for url in urls:
            try:
                resp = client.post(
                    "https://indexing.googleapis.com/v3/urlNotifications:publish",
                    headers={
                        "Authorization": f"Bearer {creds.token}",
                        "Content-Type": "application/json",
                    },
                    json={"url": url, "type": "URL_UPDATED"},
                )
                if resp.status_code == 200:
                    success += 1
                    results.append({"url": url, "status": "ok"})
                    logger.info(f"  ✅ indexed: {url[:60]}")
                else:
                    failed += 1
                    results.append({"url": url, "status": "error", "detail": resp.text[:100]})
                    logger.warning(f"  ❌ failed: {url[:60]} — {resp.status_code}")
            except Exception as e:
                failed += 1
                results.append({"url": url, "status": "error", "detail": str(e)[:100]})

    return {"success": success, "failed": failed, "results": results}


if __name__ == "__main__":
    """CLI: python indexing.py [--auth] [--index-today]"""
    import sys
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if "--auth" in sys.argv:
        # 최초 인증만 수행
        creds = _get_credentials()
        print(f"✅ 인증 완료 — token saved to {TOKEN_PATH}")
        sys.exit(0)

    if "--index-today" in sys.argv:
        # 오늘 발행된 Job의 URL 인덱싱
        from supabase import create_client
        supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

        result = supabase.table("publish_jobs").select("id, published_url, index_status").eq(
            "status", "published"
        ).neq("index_status", "requested").not_.is_("published_url", "null").execute()

        urls = [j["published_url"] for j in (result.data or []) if j.get("published_url")]
        if not urls:
            print("인덱싱할 URL이 없습니다.")
            sys.exit(0)

        print(f"{len(urls)}개 URL 인덱싱 요청 중...")
        result = batch_index(urls)
        print(f"\n완료: ✅ {result['success']}건 성공, ❌ {result['failed']}건 실패")

        # DB 업데이트
        for r in result["results"]:
            if r["status"] == "ok":
                supabase.table("publish_jobs").update({
                    "index_status": "requested",
                    "indexed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("published_url", r["url"]).execute()
