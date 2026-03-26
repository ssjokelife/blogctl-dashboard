import os
from dotenv import load_dotenv
from supabase import create_client, Client
from supabase._async.client import create_client as create_async_client, AsyncClient

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_USER_ID = os.environ["WORKER_USER_ID"]
BLOGCTL_PATH = os.environ.get("BLOGCTL_PATH", "/mnt/c/jin/projects/my-resume/blogs/scripts")

HEARTBEAT_INTERVAL = 30  # seconds
POLL_INTERVAL = 30  # polling interval (Realtime 실패 시 주요 감지 수단)
MAX_PUBLISH_ATTEMPTS = 3
PUBLISH_DELAY_SECONDS = 10  # 발행 간 대기 (Chromium 충돌 + 캡챠 방지)

# 쿠팡 파트너스 설정
# COUPANG_PARTNERS_URL: 파트너스 대시보드에서 생성한 검색 링크 템플릿
# 예: https://link.coupang.com/a/XXXXXX  (파트너스 링크가 없으면 일반 검색 URL로 폴백)
COUPANG_PARTNERS_URL = os.environ.get("COUPANG_PARTNERS_URL", "")

# 블로그당 일일 최대 발행 건수 (캡챠 방지)
DAILY_PUBLISH_LIMIT = {
    "default": 2,         # 기본: 하루 2건
    "lifezig": 3,         # 3건 허용
    "jokelife": 3,        # 키워드 많아서 3건 허용
    "kyeyangdak": 2,
}


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


async def get_async_supabase() -> AsyncClient:
    return await create_async_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
