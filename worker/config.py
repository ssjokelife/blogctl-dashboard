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
