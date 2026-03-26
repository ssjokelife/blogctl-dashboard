"""네이버 검색광고 API 클라이언트 — 키워드 검색량 조회"""
import hashlib
import hmac
import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger("naver_searchad")

API_BASE = "https://api.searchad.naver.com"
KEYWORD_TOOL_PATH = "/keywordstool"

# Rate limiting: 분당 100회
RATE_LIMIT_PER_MINUTE = 100
RATE_LIMIT_WINDOW = 60  # seconds
# 한 번에 조회 가능한 키워드 수 (API 제한)
MAX_KEYWORDS_PER_REQUEST = 5


def _get_credentials() -> Optional[tuple[str, str, str]]:
    """환경변수에서 네이버 검색광고 API 인증 정보 조회.
    미설정 시 None 반환 (graceful skip).
    """
    api_key = os.environ.get("NAVER_API_KEY")
    secret_key = os.environ.get("NAVER_SECRET_KEY")
    customer_id = os.environ.get("NAVER_CUSTOMER_ID")

    if not all([api_key, secret_key, customer_id]):
        return None
    return api_key, secret_key, customer_id


def _generate_signature(timestamp: str, method: str, path: str, secret_key: str) -> str:
    """HMAC-SHA256 서명 생성.

    네이버 검색광고 API 인증 방식:
    - message = "{timestamp}.{method}.{path}"
    - HMAC-SHA256(secret_key, message) → base64 인코딩
    """
    import base64

    message = f"{timestamp}.{method}.{path}"
    sign = hmac.new(
        secret_key.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.b64encode(sign).decode("utf-8")


def _build_headers(method: str, path: str, api_key: str, secret_key: str, customer_id: str) -> dict:
    """API 요청 헤더 생성 (인증 포함)"""
    timestamp = str(int(time.time() * 1000))
    signature = _generate_signature(timestamp, method, path, secret_key)

    return {
        "X-API-KEY": api_key,
        "X-Customer": customer_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json",
    }


class NaverSearchAdClient:
    """네이버 검색광고 API 클라이언트"""

    def __init__(self):
        creds = _get_credentials()
        self.available = creds is not None
        if creds:
            self.api_key, self.secret_key, self.customer_id = creds
        else:
            self.api_key = self.secret_key = self.customer_id = ""
            logger.info("네이버 검색광고 API 키 미설정 — 검색량 검증 비활성화")

        # Rate limiting state
        self._request_timestamps: list[float] = []

    def _wait_for_rate_limit(self):
        """분당 100회 제한 준수를 위한 대기"""
        now = time.time()
        # 1분 이전 기록 제거
        self._request_timestamps = [
            ts for ts in self._request_timestamps
            if now - ts < RATE_LIMIT_WINDOW
        ]
        if len(self._request_timestamps) >= RATE_LIMIT_PER_MINUTE:
            oldest = self._request_timestamps[0]
            wait_time = RATE_LIMIT_WINDOW - (now - oldest) + 0.5
            if wait_time > 0:
                logger.info(f"Rate limit 대기: {wait_time:.1f}초")
                time.sleep(wait_time)

        self._request_timestamps.append(time.time())

    def get_search_volume(self, keywords: list[str]) -> dict[str, dict]:
        """키워드 목록의 월간 검색량 조회.

        Args:
            keywords: 조회할 키워드 목록

        Returns:
            {keyword: {"pc": int, "mobile": int, "total": int}} 형태의 딕셔너리.
            조회 실패한 키워드는 포함되지 않음.
        """
        if not self.available:
            logger.debug("네이버 API 비활성 — 검색량 조회 건너뜀")
            return {}

        if not keywords:
            return {}

        results: dict[str, dict] = {}

        # MAX_KEYWORDS_PER_REQUEST개씩 나누어 조회
        for i in range(0, len(keywords), MAX_KEYWORDS_PER_REQUEST):
            batch = keywords[i:i + MAX_KEYWORDS_PER_REQUEST]
            try:
                batch_result = self._fetch_batch(batch)
                results.update(batch_result)
            except Exception as e:
                logger.error(f"검색량 조회 실패 (batch {i // MAX_KEYWORDS_PER_REQUEST + 1}): {e}")

        return results

    def _fetch_batch(self, keywords: list[str]) -> dict[str, dict]:
        """단일 배치 검색량 조회"""
        self._wait_for_rate_limit()

        method = "GET"
        path = KEYWORD_TOOL_PATH
        headers = _build_headers(method, path, self.api_key, self.secret_key, self.customer_id)

        # 네이버 API는 공백 포함 키워드 거부 → 공백 제거하여 조회
        cleaned = [kw.replace(" ", "") for kw in keywords]
        hint_keywords = ",".join(cleaned)
        params = {
            "hintKeywords": hint_keywords,
            "showDetail": "1",
        }

        url = f"{API_BASE}{path}"

        with httpx.Client(timeout=30) as client:
            response = client.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

        results: dict[str, dict] = {}
        keyword_list = data.get("keywordList", [])

        # 입력 키워드 → 공백제거 소문자 매핑 (원본 키워드 복원용)
        cleaned_to_original = {}
        for kw in keywords:
            cleaned_to_original[kw.replace(" ", "").strip().lower()] = kw

        for item in keyword_list:
            rel_keyword = item.get("relKeyword", "")
            rel_cleaned = rel_keyword.replace(" ", "").strip().lower()

            # 입력한 키워드와 일치하는 것만 수집 (공백 무시 비교)
            if rel_cleaned not in cleaned_to_original:
                continue

            original_kw = cleaned_to_original[rel_cleaned]
            pc = _parse_count(item.get("monthlyPcQcCnt", 0))
            mobile = _parse_count(item.get("monthlyMobileQcCnt", 0))

            results[original_kw] = {
                "pc": pc,
                "mobile": mobile,
                "total": pc + mobile,
            }

        # 입력했지만 결과에 없는 키워드는 검색량 0으로 처리
        for kw in keywords:
            if kw not in results:
                results[kw] = {"pc": 0, "mobile": 0, "total": 0}

        return results


    def get_related_keywords(self, seed_keyword: str, min_volume: int = 100) -> list[dict]:
        """시드 키워드의 연관 키워드 중 검색량 min_volume 이상인 것만 반환.

        Returns:
            [{"keyword": str, "pc": int, "mobile": int, "total": int, "competition": str}]
        """
        if not self.available:
            return []

        self._wait_for_rate_limit()

        method = "GET"
        path = KEYWORD_TOOL_PATH
        headers = _build_headers(method, path, self.api_key, self.secret_key, self.customer_id)

        cleaned = seed_keyword.replace(" ", "")
        params = {"hintKeywords": cleaned, "showDetail": "1"}
        url = f"{API_BASE}{path}"

        try:
            with httpx.Client(timeout=30) as client:
                response = client.get(url, headers=headers, params=params)
                response.raise_for_status()
                data = response.json()
        except Exception as e:
            logger.error(f"연관 키워드 조회 실패 ({seed_keyword}): {e}")
            return []

        results = []
        for item in data.get("keywordList", []):
            rel_keyword = item.get("relKeyword", "")
            pc = _parse_count(item.get("monthlyPcQcCnt", 0))
            mobile = _parse_count(item.get("monthlyMobileQcCnt", 0))
            total = pc + mobile

            if total >= min_volume:
                results.append({
                    "keyword": rel_keyword,
                    "pc": pc,
                    "mobile": mobile,
                    "total": total,
                    "competition": item.get("compIdx", ""),
                })

        # 검색량 높은 순 정렬
        results.sort(key=lambda x: -x["total"])
        return results


def _parse_count(value) -> int:
    """검색량 값 파싱. '< 10' 같은 문자열도 처리."""
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").replace("<", "").replace("~", "").strip()
        if not cleaned or cleaned == "-":
            return 0
        try:
            return int(cleaned)
        except ValueError:
            return 0
    return 0


def verify_keywords_search_volume(
    keywords: list[dict],
    min_volume: int = 10,
) -> tuple[list[dict], list[dict], dict[str, dict]]:
    """키워드 목록의 검색량을 검증하고 유효/무효로 분류.

    Args:
        keywords: [{"id": ..., "keyword": ..., ...}] 형태의 키워드 목록
        min_volume: 최소 검색량 기준 (기본 10)

    Returns:
        (valid_keywords, low_volume_keywords, volume_data)
        - valid_keywords: 검색량 기준 충족 키워드
        - low_volume_keywords: 검색량 미달 키워드
        - volume_data: {keyword: {"pc": int, "mobile": int, "total": int}}
    """
    client = NaverSearchAdClient()

    if not client.available:
        # API 비활성 — 모든 키워드 유효 처리 (기존 동작 유지)
        return keywords, [], {}

    keyword_texts = [kw["keyword"] for kw in keywords]
    volume_data = client.get_search_volume(keyword_texts)

    valid = []
    low_volume = []

    for kw in keywords:
        kw_text = kw["keyword"]
        vol = _find_volume(kw_text, volume_data)

        if vol is not None and vol["total"] >= min_volume:
            valid.append(kw)
        elif vol is not None and vol["total"] < min_volume:
            low_volume.append(kw)
            logger.warning(
                f"검색량 미달: '{kw_text}' — 월간 {vol['total']}회 (기준: {min_volume})"
            )
        else:
            # 검색량 데이터 없음 — 유효 처리 (보수적)
            valid.append(kw)

    return valid, low_volume, volume_data


def _find_volume(keyword: str, volume_data: dict[str, dict]) -> Optional[dict]:
    """대소문자/공백 무시하고 검색량 데이터 찾기"""
    kw_lower = keyword.strip().lower()
    for data_kw, vol in volume_data.items():
        if data_kw.strip().lower() == kw_lower:
            return vol
    return None
