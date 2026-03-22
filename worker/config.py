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


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


async def get_async_supabase() -> AsyncClient:
    return await create_async_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
