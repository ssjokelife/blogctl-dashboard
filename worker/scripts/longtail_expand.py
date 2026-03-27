"""짧은 키워드 → 롱테일 확장 + 네이버 검색량 검증 + 원본 paused

프로세스:
  1. 블로그별 짧은 키워드 (공백 없는 6자 이하) 수집
  2. 네이버 API로 연관 키워드 조회
  3. 검색량 기준을 10000 → 9000 → ... → 1000까지 내리며 롱테일 필터
  4. 카테고리 적합도 검증 (GPT)
  5. 새 키워드 DB 등록 + 원본 짧은 키워드 paused

실행:
  cd worker && python3 scripts/longtail_expand.py
  cd worker && python3 scripts/longtail_expand.py --blog healthnote
  cd worker && python3 scripts/longtail_expand.py --dry-run
"""
import argparse
import logging
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from config import get_supabase, WORKER_USER_ID, MAX_SEARCH_VOLUME, IDEAL_VOLUME_RANGE
from naver_searchad import NaverSearchAdClient
from keyword_filter import filter_by_relevance, get_blog_info

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# 영문 블로그 제외
ENGLISH_BLOGS = {"freelancehub", "aitoolspick", "seasiaguide", "codefirst", "saasreview"}

# 롱테일 판별: 공백 포함 또는 7자 이상
MIN_LONGTAIL_CHARS = 7

# 검색량 기준 단계별 하향
VOLUME_STEPS = [10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000]

# 블로그당 최대 새 키워드
MAX_NEW_PER_BLOG = 30


def is_short_keyword(keyword: str) -> bool:
    """짧은 키워드인지 판별 (공백 없는 6자 이하)"""
    return " " not in keyword and len(keyword) <= 6


def is_longtail(keyword: str) -> bool:
    """롱테일 키워드인지 판별 (공백 포함 또는 7자 이상)"""
    return " " in keyword or len(keyword) >= MIN_LONGTAIL_CHARS


def get_existing_keywords(supabase, blog_id: str) -> set[str]:
    """블로그의 기존 키워드 (중복 방지)"""
    result = supabase.table("keywords").select("keyword").eq(
        "blog_id", blog_id
    ).eq("user_id", WORKER_USER_ID).execute()
    return {kw["keyword"].strip().lower() for kw in (result.data or [])}


def find_longtail_for_seed(
    client: NaverSearchAdClient,
    seed: str,
    existing: set[str],
    max_volume: int,
) -> list[dict]:
    """시드 키워드에서 롱테일 연관 키워드 찾기.
    검색량 기준을 10000 → 9000 → ... 단계적으로 내리며 탐색.

    Returns:
        [{"keyword": str, "search_volume": int, "competition": str}]
    """
    # 네이버 API 호출 — 모든 연관 키워드 가져오기 (min_volume=100으로 넓게)
    related = client.get_related_keywords(seed, min_volume=100)

    if not related:
        return []

    # 롱테일 + 중복 제거 + 경쟁도 필터
    candidates = []
    for item in related:
        kw = item["keyword"]
        vol = item["total"]
        comp = item.get("competition", "")

        # 이미 있는 키워드 스킵
        if kw.strip().lower() in existing:
            continue

        # 롱테일이 아니면 스킵
        if not is_longtail(kw):
            continue

        # 경쟁도 "높음"이면 제외 (신규 블로그로 상위 노출 불가)
        if comp == "높음":
            continue

        candidates.append({
            "keyword": kw,
            "search_volume": vol,
            "competition": comp,
        })

    if not candidates:
        return []

    # 검색량 기준을 단계적으로 하향하며 필터
    for min_vol in VOLUME_STEPS:
        filtered = [c for c in candidates if c["search_volume"] >= min_vol]
        if filtered:
            logger.info(f"    → 검색량 {min_vol:,}+ 기준: {len(filtered)}개 발견")
            return filtered

    # 모든 기준 미달 — 1000 미만이라도 있으면 반환
    remaining = [c for c in candidates if c["search_volume"] >= 500]
    if remaining:
        logger.info(f"    → 검색량 500+ 기준 (최저): {len(remaining)}개 발견")
        return remaining

    return []


def expand_blog(
    supabase,
    client: NaverSearchAdClient,
    blog_id: str,
    dry_run: bool = False,
) -> dict:
    """블로그의 짧은 키워드를 롱테일로 확장.

    Returns:
        {"blog_id": str, "seeds": int, "new_keywords": int, "paused": int}
    """
    # 1. 짧은 키워드 수집
    result = supabase.table("keywords").select("id, keyword, search_volume").eq(
        "blog_id", blog_id
    ).eq("user_id", WORKER_USER_ID).eq("status", "pending").execute()

    all_keywords = result.data or []
    short_keywords = [k for k in all_keywords if is_short_keyword(k["keyword"])]

    if not short_keywords:
        logger.info(f"  {blog_id}: 짧은 키워드 없음, 건너뜀")
        return {"blog_id": blog_id, "seeds": 0, "new_keywords": 0, "paused": 0}

    logger.info(f"  {blog_id}: 짧은 키워드 {len(short_keywords)}개 발견")

    # 2. 기존 키워드 세트 (중복 방지)
    existing = get_existing_keywords(supabase, blog_id)

    # 3. 각 시드에서 롱테일 탐색
    all_new = []
    seeds_with_results = 0

    for k in short_keywords:
        seed = k["keyword"]
        logger.info(f"  시드: \"{seed}\" (vol: {k.get('search_volume', 0):,})")

        longtails = find_longtail_for_seed(
            client, seed, existing, max_volume=MAX_SEARCH_VOLUME,
        )

        if longtails:
            seeds_with_results += 1
            for lt in longtails:
                lt["seed"] = seed
                lt["seed_id"] = k["id"]
                # 중복 방지 — 이번 실행에서 추가된 것도 제외
                if lt["keyword"].strip().lower() not in existing:
                    all_new.append(lt)
                    existing.add(lt["keyword"].strip().lower())
        else:
            logger.info(f"    → 적합한 롱테일 없음")

        time.sleep(0.5)  # rate limit

    if not all_new:
        logger.info(f"  {blog_id}: 새 롱테일 키워드 없음")
        return {"blog_id": blog_id, "seeds": len(short_keywords), "new_keywords": 0, "paused": 0}

    # 4. 이상적 범위(1K~30K) 우선 정렬 + 상위 N개 선택
    def sort_key(kw):
        vol = kw["search_volume"]
        in_ideal = 0 if IDEAL_VOLUME_RANGE[0] <= vol <= IDEAL_VOLUME_RANGE[1] else 1
        return (in_ideal, -vol)

    all_new.sort(key=sort_key)
    all_new = all_new[:MAX_NEW_PER_BLOG]

    # 5. 카테고리 적합도 필터
    blog_info = get_blog_info(supabase, blog_id)
    if blog_info:
        before = len(all_new)
        filter_input = [{"keyword": kw["keyword"], "total": kw["search_volume"]} for kw in all_new]
        filtered = filter_by_relevance(
            filter_input,
            blog_label=blog_info.get("label", ""),
            blog_categories=blog_info.get("categories", []),
            blog_description=blog_info.get("description", ""),
        )
        filtered_set = {item["keyword"] for item in filtered}
        all_new = [kw for kw in all_new if kw["keyword"] in filtered_set]
        logger.info(f"  적합도 필터: {before}개 → {len(all_new)}개")

    if not all_new:
        logger.info(f"  {blog_id}: 적합도 필터 후 0개")
        return {"blog_id": blog_id, "seeds": len(short_keywords), "new_keywords": 0, "paused": 0}

    # 6. 결과 출력
    logger.info(f"\n  {blog_id} 새 롱테일 키워드 ({len(all_new)}개):")
    for kw in all_new:
        logger.info(f"    \"{kw['keyword']}\" (vol: {kw['search_volume']:,}, 시드: {kw['seed']})")

    if dry_run:
        return {"blog_id": blog_id, "seeds": len(short_keywords), "new_keywords": len(all_new), "paused": 0}

    # 7. DB 등록
    inserted = 0
    for kw in all_new:
        try:
            supabase.table("keywords").insert({
                "user_id": WORKER_USER_ID,
                "blog_id": blog_id,
                "keyword": kw["keyword"],
                "status": "pending",
                "priority": "high",
                "search_volume": kw["search_volume"],
                "verified": True,
            }).execute()
            inserted += 1
        except Exception as e:
            logger.error(f"    등록 실패: {kw['keyword']}: {e}")

    # 8. 원본 짧은 키워드 paused (롱테일이 생성된 시드만)
    seeds_expanded = {kw["seed"] for kw in all_new}
    paused = 0
    for k in short_keywords:
        if k["keyword"] in seeds_expanded:
            try:
                supabase.table("keywords").update({
                    "status": "paused",
                }).eq("id", k["id"]).execute()
                paused += 1
            except Exception as e:
                logger.error(f"    paused 실패: {k['keyword']}: {e}")

    logger.info(f"  {blog_id}: {inserted}개 등록, {paused}개 원본 paused")
    return {"blog_id": blog_id, "seeds": len(short_keywords), "new_keywords": inserted, "paused": paused}


def main():
    parser = argparse.ArgumentParser(description="짧은 키워드 → 롱테일 확장 + 검색량 검증")
    parser.add_argument("--blog", help="특정 블로그 ID (미지정 시 한국어 블로그 전체)")
    parser.add_argument("--dry-run", action="store_true", help="DB 변경 없이 미리보기")
    args = parser.parse_args()

    client = NaverSearchAdClient()
    if not client.available:
        logger.error("네이버 API 키가 설정되지 않았습니다.")
        sys.exit(1)

    supabase = get_supabase()

    if args.blog:
        blog_ids = [args.blog]
    else:
        # 한국어 블로그만 (영문 블로그 제외)
        blogs_result = supabase.table("blogs").select("id").eq(
            "user_id", WORKER_USER_ID
        ).execute()
        blog_ids = [
            b["id"] for b in (blogs_result.data or [])
            if b["id"] not in ENGLISH_BLOGS
        ]

    logger.info(f"대상 블로그: {len(blog_ids)}개")
    if args.dry_run:
        logger.info("[DRY RUN] DB 변경 없이 미리보기만 수행합니다.\n")

    results = []
    for blog_id in blog_ids:
        logger.info(f"\n{'='*60}")
        logger.info(f"블로그: {blog_id}")
        logger.info(f"{'='*60}")
        result = expand_blog(supabase, client, blog_id, dry_run=args.dry_run)
        results.append(result)

    # 최종 요약
    logger.info(f"\n{'='*60}")
    logger.info("최종 요약")
    logger.info(f"{'='*60}")
    total_seeds = 0
    total_new = 0
    total_paused = 0
    for r in results:
        if r["seeds"] > 0:
            logger.info(f"  {r['blog_id']:20s} | 시드 {r['seeds']:3d}개 | 새 키워드 {r['new_keywords']:3d}개 | paused {r['paused']:3d}개")
        total_seeds += r["seeds"]
        total_new += r["new_keywords"]
        total_paused += r["paused"]
    logger.info(f"\n  총 시드: {total_seeds}개 → 새 롱테일: {total_new}개, paused: {total_paused}개")


if __name__ == "__main__":
    main()
