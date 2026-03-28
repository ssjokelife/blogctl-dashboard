"""키워드 유사 중복 감지 — 표기 차이, 포함 관계, 발행 내역 비교"""
import re


def normalize(keyword: str) -> str:
    """키워드 정규화 — 표기 차이 통일, 공백/특수문자 제거"""
    s = keyword.strip().lower()
    s = re.sub(r'[^가-힣a-zA-Z0-9]', '', s)
    # 표기 차이 통일
    s = s.replace('레인지', '렌지')
    s = s.replace('프라이기', '프라이어')
    s = s.replace('세척기', '세척기')
    return s


def is_similar(a: str, b: str) -> bool:
    """두 키워드가 유사한지 판별.

    - 정규화 후 동일
    - 한쪽이 다른 쪽에 포함 (4자 이상)
    """
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return False

    # 정규화 후 동일
    if na == nb:
        return True

    # 포함 관계 (짧은 쪽이 4자 이상일 때)
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    if len(shorter) >= 4 and shorter in longer:
        return True

    return False


def find_duplicates_in_list(keywords: list[dict]) -> list[tuple[dict, dict]]:
    """키워드 리스트에서 유사 중복 쌍을 찾기.

    Args:
        keywords: [{"id": int, "keyword": str, "search_volume": int, ...}]

    Returns:
        [(keep, remove)] 쌍 리스트. 검색량 높은 쪽이 keep.
    """
    # 검색량 높은 순 정렬
    sorted_kws = sorted(keywords, key=lambda k: -(k.get("search_volume") or 0))
    duplicates = []
    seen_ids = set()

    for i, a in enumerate(sorted_kws):
        if a["id"] in seen_ids:
            continue
        for j, b in enumerate(sorted_kws):
            if i >= j or b["id"] in seen_ids:
                continue
            if is_similar(a["keyword"], b["keyword"]):
                duplicates.append((a, b))
                seen_ids.add(b["id"])

    return duplicates


def is_duplicate_of_published(keyword: str, published_set: set) -> bool:
    """키워드가 발행 내역(키워드+제목)과 유사 중복인지 확인.

    Args:
        keyword: 확인할 키워드
        published_set: get_published_keywords()로 얻은 발행 키워드/제목 세트

    Returns:
        True if duplicate
    """
    nk = normalize(keyword)
    if not nk:
        return False

    for pub in published_set:
        np = normalize(pub)
        if not np:
            continue
        # 정규화 후 동일
        if nk == np:
            return True
        # 포함 관계
        shorter, longer = (nk, np) if len(nk) <= len(np) else (np, nk)
        if len(shorter) >= 4 and shorter in longer:
            return True

    return False


def is_duplicate_of_existing(keyword: str, existing_keywords: list[str]) -> bool:
    """키워드가 기존 키워드 목록과 유사 중복인지 확인.

    Args:
        keyword: 확인할 키워드
        existing_keywords: 기존 키워드 문자열 리스트
    """
    for existing in existing_keywords:
        if is_similar(keyword, existing):
            return True
    return False
