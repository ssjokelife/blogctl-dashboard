"""키워드 카테고리 적합도 필터 — GPT-4o-mini로 블로그 주제와의 관련성 판별"""
import json
import logging
import os
from typing import Optional

logger = logging.getLogger("keyword_filter")


def filter_by_relevance(
    keywords: list[dict],
    blog_label: str,
    blog_categories: list[str],
    blog_description: str = "",
    batch_size: int = 30,
) -> list[dict]:
    """키워드 목록에서 블로그 주제와 관련 있는 것만 필터링.

    Args:
        keywords: [{"keyword": str, ...}] 형태
        blog_label: 블로그 이름/설명
        blog_categories: 블로그 카테고리 목록
        blog_description: 블로그 상세 설명
        batch_size: GPT 한 번에 판별할 키워드 수

    Returns:
        관련성 있는 키워드만 필터링된 리스트
    """
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.warning("OPENAI_API_KEY 미설정 — 적합도 필터 건너뜀")
        return keywords

    if not keywords:
        return []

    client = openai.OpenAI(api_key=api_key)
    categories_str = ", ".join(blog_categories) if blog_categories else "없음"

    system_prompt = f"""당신은 블로그 키워드 적합도 판별기입니다.

블로그 정보:
- 이름: {blog_label}
- 카테고리: {categories_str}
- 설명: {blog_description or '없음'}

주어진 키워드 목록에서 이 블로그에 글을 쓰기 적합한 키워드만 선별하세요.

제외 기준:
- 블로그 주제와 무관한 키워드 (예: 건강 블로그에 "주식시세")
- 실시간 시세/뉴스 키워드 (예: "삼성전자주가", "달러환율", "비트코인시세") — 블로그 글로 트래픽 확보 불가
- 특정 지역/매장 키워드 (예: "상암맛집", "강남역") — 범용 콘텐츠 부적합
- 브랜드 고유명사만 있는 키워드 (예: "삼성서비스", "코웨이페스타") — 공식 사이트에 밀림
- 너무 포괄적인 1어절 키워드 (예: "이미지", "창업", "HTML") — 경쟁 불가

포함 기준:
- 블로그 카테고리와 직접 관련 있는 키워드
- "방법", "추천", "비교", "사용법", "만들기" 등 정보성 검색 의도
- 블로그 글로 상위 노출 가능한 롱테일 키워드

JSON 배열로 적합한 키워드 번호만 반환:
{{"relevant": [1, 3, 5, ...]}}"""

    all_relevant = []
    total = len(keywords)

    for i in range(0, total, batch_size):
        batch = keywords[i:i + batch_size]
        kw_list = "\n".join(f"{j+1}. {kw['keyword']} ({kw.get('total', kw.get('search_volume', 0)):,}회/월)" for j, kw in enumerate(batch))

        try:
            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"다음 키워드의 적합도를 판별하세요:\n\n{kw_list}"},
                ],
                max_tokens=500,
                temperature=0,
                response_format={"type": "json_object"},
            )

            raw = completion.choices[0].message.content or "{}"
            parsed = json.loads(raw)
            relevant_indices = parsed.get("relevant", [])

            for idx in relevant_indices:
                if 1 <= idx <= len(batch):
                    all_relevant.append(batch[idx - 1])

            passed = len(relevant_indices)
            filtered = len(batch) - passed
            logger.info(f"  적합도 필터 (batch {i//batch_size + 1}): {passed}개 통과, {filtered}개 제외")

        except Exception as e:
            logger.error(f"  적합도 필터 오류: {e} — 배치 전체 통과 처리")
            all_relevant.extend(batch)

    logger.info(f"  적합도 필터 결과: {len(all_relevant)}/{total}개 통과")
    return all_relevant


def get_blog_info(supabase, blog_id: str) -> Optional[dict]:
    """블로그 정보 조회"""
    result = supabase.table("blogs").select(
        "id, label, categories, description"
    ).eq("id", blog_id).single().execute()
    return result.data if result.data else None
