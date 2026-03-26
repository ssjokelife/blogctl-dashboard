"""GSC 검색어 → keywords 테이블 자동 등록

Google Search Console의 실제 노출/클릭 데이터를 기반으로
keywords 테이블에 자동으로 키워드를 등록한다.
"""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from config import get_supabase, WORKER_USER_ID

logger = logging.getLogger("gsc_keywords")

# GSC 사이트 → blog_id 매핑
# GSC 속성은 "sc-domain:" 또는 "https://..." 형태
SITE_TO_BLOG = {
    "sc-domain:kyeyangdak.tistory.com": "kyeyangdak",
    "https://kyeyangdak.tistory.com/": "kyeyangdak",
    "sc-domain:jokelife.tistory.com": "jokelife",
    "https://jokelife.tistory.com/": "jokelife",
    "sc-domain:lukulu.tistory.com": "lukulu",
    "https://lukulu.tistory.com/": "lukulu",
    "sc-domain:lifezig.tistory.com": "lifezig",
    "https://lifezig.tistory.com/": "lifezig",
    "sc-domain:savemoney-note.tistory.com": "moneysave",
    "https://savemoney-note.tistory.com/": "moneysave",
    "sc-domain:log-memo.tistory.com": "healthnote",
    "https://log-memo.tistory.com/": "healthnote",
    "sc-domain:mannerboy.tistory.com": "yejeolsa",
    "https://mannerboy.tistory.com/": "yejeolsa",
    "sc-domain:eye-contact-with.tistory.com": "kkumpuri",
    "https://eye-contact-with.tistory.com/": "kkumpuri",
    "sc-domain:aitoolspick2026.blogspot.com": "aitoolspick",
    "https://aitoolspick2026.blogspot.com/": "aitoolspick",
    "sc-domain:freelancehub-jin.hashnode.dev": "freelancehub",
    "https://freelancehub-jin.hashnode.dev/": "freelancehub",
}

# blog_id → GSC 사이트 URL (역매핑 — 조회에 사용)
BLOG_TO_SITES = {}
for site_url, blog_id in SITE_TO_BLOG.items():
    BLOG_TO_SITES.setdefault(blog_id, []).append(site_url)

# 최소 노출수 기준
MIN_IMPRESSIONS = 10


def _get_gsc_service():
    """Service Account로 GSC API 서비스 생성"""
    from googleapiclient.discovery import build
    from google.oauth2 import service_account

    key_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if not key_json:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_KEY 환경변수가 설정되지 않았습니다")

    credentials = service_account.Credentials.from_service_account_info(
        json.loads(key_json),
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )
    return build("searchconsole", "v1", credentials=credentials)


def _fetch_gsc_queries(service, site_url: str, start_date: str, end_date: str) -> list[dict]:
    """GSC searchAnalytics.query로 검색어 데이터 조회

    Returns: [{"query": str, "page": str, "clicks": int, "impressions": int, "ctr": float, "position": float}]
    """
    all_rows = []
    start_row = 0
    row_limit = 1000

    while True:
        try:
            response = service.searchanalytics().query(
                siteUrl=site_url,
                body={
                    "startDate": start_date,
                    "endDate": end_date,
                    "dimensions": ["query", "page"],
                    "rowLimit": row_limit,
                    "startRow": start_row,
                },
            ).execute()
        except Exception as e:
            logger.warning(f"GSC API 오류 ({site_url}): {e}")
            break

        rows = response.get("rows", [])
        if not rows:
            break

        for row in rows:
            keys = row.get("keys", [])
            if len(keys) >= 2:
                all_rows.append({
                    "query": keys[0],
                    "page": keys[1],
                    "clicks": row.get("clicks", 0),
                    "impressions": row.get("impressions", 0),
                    "ctr": row.get("ctr", 0.0),
                    "position": row.get("position", 0.0),
                })

        if len(rows) < row_limit:
            break
        start_row += row_limit

    return all_rows


def _aggregate_queries(rows: list[dict]) -> list[dict]:
    """같은 query의 page별 데이터를 합산하여 query 단위로 집계

    Returns: [{"query": str, "clicks": int, "impressions": int, "ctr": float, "position": float, "pages": list}]
    """
    query_map = {}
    for row in rows:
        q = row["query"]
        if q not in query_map:
            query_map[q] = {
                "query": q,
                "clicks": 0,
                "impressions": 0,
                "ctr_sum": 0.0,
                "position_sum": 0.0,
                "count": 0,
                "pages": [],
            }
        agg = query_map[q]
        agg["clicks"] += row["clicks"]
        agg["impressions"] += row["impressions"]
        agg["ctr_sum"] += row["ctr"] * row["impressions"]  # 가중 평균용
        agg["position_sum"] += row["position"] * row["impressions"]
        agg["count"] += 1
        if row["page"] not in agg["pages"]:
            agg["pages"].append(row["page"])

    result = []
    for agg in query_map.values():
        imp = agg["impressions"]
        result.append({
            "query": agg["query"],
            "clicks": agg["clicks"],
            "impressions": imp,
            "ctr": agg["ctr_sum"] / imp if imp > 0 else 0.0,
            "position": agg["position_sum"] / imp if imp > 0 else 0.0,
            "pages": agg["pages"],
        })

    return result


def sync_gsc_keywords(supabase=None, days: int = 7, min_impressions: int = MIN_IMPRESSIONS) -> dict:
    """GSC 검색어를 keywords 테이블에 동기화

    Args:
        supabase: Supabase 클라이언트 (None이면 자동 생성)
        days: 조회 기간 (기본 7일)
        min_impressions: 최소 노출수 기준

    Returns:
        {"total_queries": int, "new_keywords": int, "skipped_existing": int, "errors": list}
    """
    if supabase is None:
        supabase = get_supabase()

    logger.info("=== GSC 키워드 동기화 시작 ===")

    # 날짜 범위 (GSC는 2~3일 전까지만 데이터 있음)
    end_date = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%d")
    start_date = (datetime.now(timezone.utc) - timedelta(days=days + 2)).strftime("%Y-%m-%d")
    logger.info(f"  조회 기간: {start_date} ~ {end_date}")

    # GSC 서비스 생성
    try:
        service = _get_gsc_service()
    except Exception as e:
        logger.error(f"GSC 서비스 생성 실패: {e}")
        return {"total_queries": 0, "new_keywords": 0, "skipped_existing": 0, "errors": [str(e)]}

    # blogs 테이블에서 blog_id 목록 조회
    blogs_result = supabase.table("blogs").select("id").eq("user_id", WORKER_USER_ID).execute()
    valid_blog_ids = {b["id"] for b in (blogs_result.data or [])}

    # 기존 키워드 조회 (중복 방지)
    existing_result = supabase.table("keywords").select("keyword, blog_id").eq(
        "user_id", WORKER_USER_ID
    ).execute()
    existing_set = {(kw["keyword"].strip().lower(), kw["blog_id"]) for kw in (existing_result.data or [])}

    # GSC에서 등록 가능한 사이트 목록 조회
    try:
        sites_response = service.sites().list().execute()
        available_sites = {s["siteUrl"] for s in (sites_response.get("siteEntry", []))}
        logger.info(f"  GSC 등록 사이트: {len(available_sites)}개")
    except Exception as e:
        logger.warning(f"GSC 사이트 목록 조회 실패: {e}")
        available_sites = set()

    total_queries = 0
    new_keywords = 0
    skipped_existing = 0
    errors = []

    # 각 블로그별로 GSC 데이터 조회
    for blog_id in valid_blog_ids:
        site_urls = BLOG_TO_SITES.get(blog_id, [])
        if not site_urls:
            continue

        # 사용 가능한 사이트 URL 찾기
        site_url = None
        for url in site_urls:
            if url in available_sites:
                site_url = url
                break

        if not site_url:
            logger.debug(f"  {blog_id}: GSC에 등록된 사이트 없음 (후보: {site_urls})")
            continue

        logger.info(f"  {blog_id}: GSC 조회 중 ({site_url})")

        # GSC 데이터 조회
        rows = _fetch_gsc_queries(service, site_url, start_date, end_date)
        if not rows:
            logger.info(f"  {blog_id}: 검색어 데이터 없음")
            continue

        # query별 집계
        aggregated = _aggregate_queries(rows)
        # 최소 노출수 필터
        filtered = [q for q in aggregated if q["impressions"] >= min_impressions]
        total_queries += len(filtered)

        logger.info(f"  {blog_id}: {len(rows)}행 → {len(aggregated)}개 검색어 → {len(filtered)}개 (노출 {min_impressions}+)")

        # 키워드 등록
        to_insert = []
        for q in filtered:
            keyword = q["query"].strip()
            if not keyword:
                continue

            if (keyword.lower(), blog_id) in existing_set:
                skipped_existing += 1
                continue

            # search_volume: 7일 노출수 → 4주 환산 (×4)
            search_volume_4w = q["impressions"] * 4
            # expected_clicks_4w: 7일 클릭수 → 4주 환산
            expected_clicks_4w = q["clicks"] * 4

            # 우선순위 결정: 클릭 있으면 높은 우선순위
            if q["clicks"] >= 5:
                priority = "high"
            elif q["clicks"] >= 1:
                priority = "medium"
            else:
                priority = "low"

            to_insert.append({
                "user_id": WORKER_USER_ID,
                "blog_id": blog_id,
                "keyword": keyword,
                "status": "active",
                "priority": priority,
                "search_volume": search_volume_4w,
                "expected_clicks_4w": expected_clicks_4w,
                "verified": True,
                "source": "gsc",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

            # existing_set에 추가 (동일 실행 내 중복 방지)
            existing_set.add((keyword.lower(), blog_id))

        if to_insert:
            # 배치 삽입 (50개씩)
            batch_size = 50
            for i in range(0, len(to_insert), batch_size):
                batch = to_insert[i:i + batch_size]
                try:
                    supabase.table("keywords").insert(batch).execute()
                    new_keywords += len(batch)
                except Exception as e:
                    logger.error(f"  {blog_id}: 키워드 등록 실패 — {e}")
                    errors.append(f"{blog_id}: {e}")

            logger.info(f"  {blog_id}: {len(to_insert)}개 새 키워드 등록")

    logger.info(f"=== GSC 키워드 동기화 완료: 총 {total_queries}개 검색어, {new_keywords}개 신규, {skipped_existing}개 기존 ===")

    return {
        "total_queries": total_queries,
        "new_keywords": new_keywords,
        "skipped_existing": skipped_existing,
        "errors": errors,
    }


if __name__ == "__main__":
    """CLI: python gsc_keywords.py [--days N] [--min-impressions N] [--dry-run]"""
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    days = 7
    min_imp = MIN_IMPRESSIONS
    dry_run = "--dry-run" in sys.argv

    for i, arg in enumerate(sys.argv):
        if arg == "--days" and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])
        elif arg == "--min-impressions" and i + 1 < len(sys.argv):
            min_imp = int(sys.argv[i + 1])

    if dry_run:
        # dry-run: GSC 데이터만 조회하고 등록하지 않음
        logger.info("=== DRY RUN 모드 ===")
        service = _get_gsc_service()

        end_date = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%d")
        start_date = (datetime.now(timezone.utc) - timedelta(days=days + 2)).strftime("%Y-%m-%d")

        sites_response = service.sites().list().execute()
        available_sites = {s["siteUrl"] for s in (sites_response.get("siteEntry", []))}

        supabase = get_supabase()
        blogs_result = supabase.table("blogs").select("id").eq("user_id", WORKER_USER_ID).execute()

        for blog in (blogs_result.data or []):
            blog_id = blog["id"]
            site_urls = BLOG_TO_SITES.get(blog_id, [])
            site_url = next((u for u in site_urls if u in available_sites), None)
            if not site_url:
                continue

            rows = _fetch_gsc_queries(service, site_url, start_date, end_date)
            aggregated = _aggregate_queries(rows)
            filtered = [q for q in aggregated if q["impressions"] >= min_imp]

            print(f"\n=== {blog_id} ({site_url}) ===")
            print(f"총 {len(filtered)}개 검색어 (노출 {min_imp}+)")
            for q in sorted(filtered, key=lambda x: x["impressions"], reverse=True)[:20]:
                print(f"  {q['impressions']:5d}노출 {q['clicks']:3d}클릭 {q['position']:5.1f}위 | {q['query']}")
    else:
        result = sync_gsc_keywords(days=days, min_impressions=min_imp)
        print(f"\n결과: {result['new_keywords']}개 신규 등록, {result['skipped_existing']}개 기존, {result['total_queries']}개 검색어")
        if result["errors"]:
            print(f"오류: {result['errors']}")
