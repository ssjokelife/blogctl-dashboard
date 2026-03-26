"""키워드 확장 스크립트 — 시드 키워드에서 연관 키워드를 네이버 API로 수집하여 DB에 등록"""
import argparse
import logging
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from config import get_supabase, WORKER_USER_ID
from naver_searchad import NaverSearchAdClient
from keyword_filter import filter_by_relevance, get_blog_info

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def get_existing_keywords(supabase, blog_id: str) -> set[str]:
    """블로그의 기존 키워드 목록 (중복 방지용)"""
    result = supabase.table("keywords").select("keyword").eq(
        "blog_id", blog_id
    ).eq("user_id", WORKER_USER_ID).execute()
    return {kw["keyword"].strip().lower() for kw in (result.data or [])}


def expand_from_seeds(
    supabase,
    client: NaverSearchAdClient,
    blog_id: str,
    seeds: list[str],
    min_volume: int = 100,
    max_per_seed: int = 20,
    dry_run: bool = False,
) -> list[dict]:
    """시드 키워드에서 연관 키워드 확장.

    Returns:
        등록된 새 키워드 목록
    """
    existing = get_existing_keywords(supabase, blog_id)
    new_keywords = []

    for seed in seeds:
        logger.info(f"시드: \"{seed}\" → 연관 키워드 조회 중...")
        related = client.get_related_keywords(seed, min_volume=min_volume)

        added = 0
        for item in related:
            kw = item["keyword"]
            if kw.strip().lower() in existing:
                continue
            if added >= max_per_seed:
                break

            existing.add(kw.strip().lower())
            new_keywords.append({
                "keyword": kw,
                "blog_id": blog_id,
                "search_volume": item["total"],
                "competition": item["competition"],
                "seed": seed,
            })
            added += 1

        found = len(related)
        logger.info(f"  → {found}개 발견, {added}개 신규 (검색량 {min_volume}+, 중복 제외)")
        time.sleep(1)  # rate limit

    if not new_keywords:
        logger.info("새로 추가할 키워드가 없습니다.")
        return []

    # 카테고리 적합도 필터
    blog_info = get_blog_info(supabase, blog_id)
    if blog_info:
        before = len(new_keywords)
        # filter_by_relevance는 {"keyword": ..., "total": ...} 형태 필요
        filter_input = [{"keyword": kw["keyword"], "total": kw["search_volume"]} for kw in new_keywords]
        filtered = filter_by_relevance(
            filter_input,
            blog_label=blog_info.get("label", ""),
            blog_categories=blog_info.get("categories", []),
            blog_description=blog_info.get("description", ""),
        )
        filtered_keywords = {item["keyword"] for item in filtered}
        new_keywords = [kw for kw in new_keywords if kw["keyword"] in filtered_keywords]
        logger.info(f"카테고리 적합도 필터: {before}개 → {len(new_keywords)}개")

    if not new_keywords:
        logger.info("적합도 필터 후 추가할 키워드가 없습니다.")
        return []

    if dry_run:
        logger.info(f"\n[DRY RUN] 등록 예정: {len(new_keywords)}개")
        for kw in new_keywords:
            logger.info(f"  {kw['keyword']:30s} | 월간 {kw['search_volume']:>6,}회 | 경쟁 {kw['competition']} | 시드: {kw['seed']}")
        return new_keywords

    # DB에 등록
    inserted = 0
    for kw in new_keywords:
        try:
            supabase.table("keywords").insert({
                "user_id": WORKER_USER_ID,
                "blog_id": blog_id,
                "keyword": kw["keyword"],
                "status": "pending",
                "priority": "high" if kw["search_volume"] >= 1000 else "medium",
                "search_volume": kw["search_volume"],
                "verified": True,
            }).execute()
            inserted += 1
            logger.info(f"  ✅ {kw['keyword']} ({kw['search_volume']:,}회/월)")
        except Exception as e:
            logger.error(f"  ❌ {kw['keyword']}: {e}")

    logger.info(f"\n총 {inserted}/{len(new_keywords)}개 등록 완료")
    return new_keywords


def expand_all_blogs(
    supabase,
    client: NaverSearchAdClient,
    min_volume: int = 100,
    max_per_seed: int = 20,
    dry_run: bool = False,
):
    """모든 블로그의 검색량 100+ 키워드를 시드로 사용하여 확장"""
    # 검색량 100+ 기존 키워드를 시드로 사용
    result = supabase.table("keywords").select("keyword, blog_id, search_volume").eq(
        "user_id", WORKER_USER_ID
    ).gte("search_volume", min_volume).execute()

    seeds_by_blog: dict[str, list[str]] = {}
    for kw in (result.data or []):
        blog_id = kw["blog_id"]
        seeds_by_blog.setdefault(blog_id, []).append(kw["keyword"])

    if not seeds_by_blog:
        logger.warning("검색량 100+ 키워드가 없습니다. 수동으로 시드 키워드를 지정하세요.")
        return

    total_new = 0
    for blog_id, seeds in seeds_by_blog.items():
        logger.info(f"\n{'='*60}")
        logger.info(f"블로그: {blog_id} (시드 {len(seeds)}개)")
        logger.info(f"{'='*60}")
        new_kws = expand_from_seeds(
            supabase, client, blog_id, seeds,
            min_volume=min_volume, max_per_seed=max_per_seed, dry_run=dry_run,
        )
        total_new += len(new_kws)

    logger.info(f"\n전체 결과: {total_new}개 새 키워드")


def main():
    parser = argparse.ArgumentParser(description="네이버 연관 키워드 확장")
    parser.add_argument("--blog", help="특정 블로그 ID (미지정 시 전체)")
    parser.add_argument("--seeds", nargs="+", help="수동 시드 키워드 (--blog 필수)")
    parser.add_argument("--min-volume", type=int, default=100, help="최소 검색량 (기본 100)")
    parser.add_argument("--max-per-seed", type=int, default=20, help="시드당 최대 키워드 수 (기본 20)")
    parser.add_argument("--dry-run", action="store_true", help="DB 등록 없이 미리보기")
    args = parser.parse_args()

    client = NaverSearchAdClient()
    if not client.available:
        logger.error("네이버 API 키가 설정되지 않았습니다.")
        sys.exit(1)

    supabase = get_supabase()

    if args.seeds:
        if not args.blog:
            logger.error("--seeds 사용 시 --blog 필수")
            sys.exit(1)
        expand_from_seeds(
            supabase, client, args.blog, args.seeds,
            min_volume=args.min_volume, max_per_seed=args.max_per_seed, dry_run=args.dry_run,
        )
    elif args.blog:
        # 해당 블로그의 기존 100+ 키워드를 시드로
        result = supabase.table("keywords").select("keyword").eq(
            "blog_id", args.blog
        ).eq("user_id", WORKER_USER_ID).gte("search_volume", args.min_volume).execute()
        seeds = [kw["keyword"] for kw in (result.data or [])]
        if not seeds:
            logger.warning(f"{args.blog}: 검색량 {args.min_volume}+ 키워드 없음. --seeds로 시드를 지정하세요.")
            sys.exit(0)
        expand_from_seeds(
            supabase, client, args.blog, seeds,
            min_volume=args.min_volume, max_per_seed=args.max_per_seed, dry_run=args.dry_run,
        )
    else:
        expand_all_blogs(
            supabase, client,
            min_volume=args.min_volume, max_per_seed=args.max_per_seed, dry_run=args.dry_run,
        )


if __name__ == "__main__":
    main()
