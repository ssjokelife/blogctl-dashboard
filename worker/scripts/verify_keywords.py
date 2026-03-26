#!/usr/bin/env python3
"""기존 pending 키워드 일괄 검색량 검증 스크립트.

사용법:
    cd worker
    export $(cat .env | grep -v '^#' | xargs)
    python scripts/verify_keywords.py [--min-volume 10] [--dry-run] [--all]

옵션:
    --min-volume N : 최소 검색량 기준 (기본: 10)
    --dry-run      : DB 업데이트 없이 결과만 출력
    --all          : pending 외 모든 키워드 검증 (기본: pending만)
"""
import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone

# worker 디렉토리를 path에 추가
worker_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, worker_dir)

from config import WORKER_USER_ID, get_supabase
from naver_searchad import NaverSearchAdClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("verify_keywords")


def main():
    parser = argparse.ArgumentParser(description="키워드 검색량 일괄 검증")
    parser.add_argument("--min-volume", type=int, default=10, help="최소 검색량 기준 (기본: 10)")
    parser.add_argument("--dry-run", action="store_true", help="DB 업데이트 없이 결과만 출력")
    parser.add_argument("--all", action="store_true", help="모든 키워드 검증 (기본: pending만)")
    args = parser.parse_args()

    client = NaverSearchAdClient()
    if not client.available:
        logger.error("네이버 검색광고 API 키가 설정되지 않았습니다.")
        logger.error("필요 환경변수: NAVER_API_KEY, NAVER_SECRET_KEY, NAVER_CUSTOMER_ID")
        sys.exit(1)

    supabase = get_supabase()

    # 키워드 조회
    query = supabase.table("keywords").select("id, keyword, blog_id, search_volume, verified, status, priority").eq(
        "user_id", WORKER_USER_ID
    )
    if not args.all:
        query = query.eq("status", "pending")

    result = query.execute()
    keywords = result.data or []

    if not keywords:
        logger.info("검증할 키워드가 없습니다.")
        return

    logger.info(f"검증 대상: {len(keywords)}개 키워드")

    # 통계
    stats = {
        "total": len(keywords),
        "verified": 0,
        "high_volume": 0,   # >= 100
        "medium_volume": 0,  # 10 ~ 99
        "low_volume": 0,     # 1 ~ 9
        "zero_volume": 0,    # 0
        "errors": 0,
        "already_verified": 0,
    }

    # 이미 검증된 키워드 건너뛰기 (--all 시 재검증)
    to_verify = keywords if args.all else [kw for kw in keywords if not kw.get("verified")]
    already_verified = len(keywords) - len(to_verify)
    stats["already_verified"] = already_verified
    if already_verified > 0:
        logger.info(f"이미 검증된 키워드: {already_verified}개 (건너뜀)")

    if not to_verify:
        logger.info("새로 검증할 키워드가 없습니다.")
        _print_summary(keywords, stats, args.min_volume)
        return

    logger.info(f"검증 시작: {len(to_verify)}개 키워드")

    # 5개씩 배치 조회
    batch_size = 5
    for i in range(0, len(to_verify), batch_size):
        batch = to_verify[i:i + batch_size]
        batch_keywords = [kw["keyword"] for kw in batch]
        batch_num = i // batch_size + 1
        total_batches = (len(to_verify) + batch_size - 1) // batch_size

        logger.info(f"배치 {batch_num}/{total_batches}: {', '.join(batch_keywords)}")

        try:
            volume_data = client.get_search_volume(batch_keywords)

            for kw in batch:
                kw_text = kw["keyword"]
                vol = _find_volume(kw_text, volume_data)
                total_vol = vol["total"] if vol else 0

                # 통계 업데이트
                stats["verified"] += 1
                if total_vol >= 100:
                    stats["high_volume"] += 1
                elif total_vol >= args.min_volume:
                    stats["medium_volume"] += 1
                elif total_vol > 0:
                    stats["low_volume"] += 1
                else:
                    stats["zero_volume"] += 1

                # 결과 출력
                status_icon = "O" if total_vol >= args.min_volume else "X"
                logger.info(
                    f"  [{status_icon}] {kw_text}: "
                    f"PC {vol['pc'] if vol else 0} + Mobile {vol['mobile'] if vol else 0} "
                    f"= 총 {total_vol}회/월"
                )

                # DB 업데이트
                if not args.dry_run:
                    try:
                        supabase.table("keywords").update({
                            "search_volume": total_vol,
                            "verified": True,
                            "verified_at": datetime.now(timezone.utc).isoformat(),
                        }).eq("id", kw["id"]).execute()
                    except Exception as e:
                        logger.error(f"  DB 업데이트 실패 ({kw['id']}): {e}")
                        stats["errors"] += 1

        except Exception as e:
            logger.error(f"배치 조회 실패: {e}")
            stats["errors"] += len(batch)

        # 배치 간 간격 (rate limit 여유)
        if i + batch_size < len(to_verify):
            time.sleep(1)

    # 최종 요약
    _print_summary(keywords, stats, args.min_volume)

    if args.dry_run:
        logger.info("(dry-run 모드 — DB 업데이트 없음)")


def _find_volume(keyword: str, volume_data: dict) -> dict | None:
    kw_lower = keyword.strip().lower()
    for data_kw, vol in volume_data.items():
        if data_kw.strip().lower() == kw_lower:
            return vol
    return None


def _print_summary(keywords, stats, min_volume):
    logger.info("=" * 60)
    logger.info("검증 결과 요약")
    logger.info("=" * 60)
    logger.info(f"  전체 키워드: {stats['total']}개")
    logger.info(f"  이미 검증됨: {stats['already_verified']}개")
    logger.info(f"  이번 검증:   {stats['verified']}개")
    logger.info(f"    검색량 100+:  {stats['high_volume']}개")
    logger.info(f"    검색량 {min_volume}~99: {stats['medium_volume']}개")
    logger.info(f"    검색량 1~{min_volume - 1}:   {stats['low_volume']}개")
    logger.info(f"    검색량 0:     {stats['zero_volume']}개")
    logger.info(f"  오류:        {stats['errors']}개")
    logger.info("=" * 60)

    # 검색량 0인 키워드 목록
    if stats["zero_volume"] > 0:
        logger.warning(f"검색량 0 키워드 ({stats['zero_volume']}개) — 키워드 교체 권장:")
        # 재조회는 하지 않고 경고만


if __name__ == "__main__":
    main()
