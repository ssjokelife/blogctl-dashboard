"""영문 블로그 키워드 + 빅키워드(5만+) 일괄 paused 처리

실행:
  cd worker && python3 scripts/cleanup_bigkeywords.py
"""
import sys
sys.path.insert(0, ".")
from config import get_supabase, WORKER_USER_ID

sb = get_supabase()

# === 1. 영문 블로그 키워드 paused ===
ENGLISH_BLOGS = ["freelancehub", "aitoolspick", "seasiaguide", "codefirst", "saasreview"]

print("=== 영문 블로그 키워드 정리 ===")
total_en = 0
for blog_id in ENGLISH_BLOGS:
    kws = sb.table("keywords").select("id, keyword, search_volume").eq(
        "blog_id", blog_id
    ).eq("user_id", WORKER_USER_ID).eq("status", "pending").execute()

    count = 0
    for k in (kws.data or []):
        sb.table("keywords").update({"status": "paused"}).eq("id", k["id"]).execute()
        count += 1

    print(f"  {blog_id}: {count}개 키워드 → paused")
    total_en += count

print(f"영문 블로그 총 {total_en}개 paused\n")

# === 2. 한국어 블로그 빅키워드(5만+) paused ===
print("=== 빅키워드(5만+) 정리 ===")
big_kws = sb.table("keywords").select("id, keyword, search_volume, blog_id").eq(
    "user_id", WORKER_USER_ID
).eq("status", "pending").eq("verified", True).gte("search_volume", 50000).execute()

total_big = 0
for k in (big_kws.data or []):
    sb.table("keywords").update({"status": "paused"}).eq("id", k["id"]).execute()
    print(f"  paused: {k['blog_id']} — {k['keyword']} (vol: {k['search_volume']})")
    total_big += 1

print(f"빅키워드 {total_big}개 → paused\n")

print(f"총 정리: 영문 {total_en}개 + 빅키워드 {total_big}개 = {total_en + total_big}개")
print("향후 Google Keyword Planner로 영문 키워드를 재수집하여 import 필요.")
