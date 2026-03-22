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
