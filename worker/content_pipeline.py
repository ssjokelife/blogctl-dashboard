"""콘텐츠 생성 파이프라인 — 리서치 → 아웃라인 → 섹션별 생성 → 조립 → 검증"""
import json
import logging
import os
import re
from datetime import datetime

import openai

from config import (
    CONTENT_MAX_TOKENS, CONTENT_OUTLINE_TOKENS, CONTENT_RESEARCH_TOKENS,
    CONTENT_META_TOKENS, CONTENT_MIN_CHARS, CONTENT_QUALITY_THRESHOLD,
    CONTENT_MAX_RETRIES, CONTENT_PIPELINE_MAX_RETRIES,
)
from prompts import get_content_strategy

logger = logging.getLogger("pipeline")


def _call_gpt(client, messages: list, max_tokens: int, temperature: float = 0.7, json_mode: bool = True) -> tuple[dict | str, int]:
    """GPT 호출 래퍼. (parsed_result, tokens_used) 반환."""
    kwargs = {
        "model": "gpt-4o-mini",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    completion = client.chat.completions.create(**kwargs)
    raw = completion.choices[0].message.content or ("{}" if json_mode else "")
    tokens = completion.usage.total_tokens if completion.usage else 0

    if json_mode:
        try:
            return json.loads(raw), tokens
        except json.JSONDecodeError:
            return {"error": "JSON 파싱 실패", "raw": raw}, tokens
    return raw, tokens


def step1_research(client, keyword: str, purpose: str, blog_context: dict) -> tuple[dict, int]:
    """Step 1: 키워드 리서치 — 검색 의도, 타겟 독자, 다뤄야 할 소주제 도출"""
    system = f"""당신은 SEO 콘텐츠 기획 전문가입니다.
키워드를 분석하여 블로그 글 기획에 필요한 정보를 도출하세요.

블로그 정보:
- 페르소나: {blog_context.get('persona', '블로거')}
- 목적: {purpose}
- 타겟 독자: {blog_context.get('target_audience', '일반 독자')}

JSON으로 응답:
{{
  "search_intent": "정보형|비교형|구매형|체험형 중 하나",
  "target_reader": "이 키워드를 검색하는 사람의 구체적 프로필",
  "reader_needs": ["독자가 알고 싶어하는 것 3~5개"],
  "subtopics": ["다뤄야 할 소주제 5~7개 — 구체적으로"],
  "differentiation": "기존 상위 글 대비 차별화 포인트",
  "required_data": ["글에 반드시 포함해야 할 구체적 데이터/수치 종류"]
}}"""

    user = f"키워드: {keyword}"
    return _call_gpt(client, [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=CONTENT_RESEARCH_TOKENS, temperature=0.5)


def step2_outline(client, keyword: str, research: dict, purpose: str, blog_context: dict, strategy: dict) -> tuple[dict, int]:
    """Step 2: 아웃라인 생성 — H2/H3 구조 + 섹션별 핵심 포인트 + 필수 요소"""
    min_sections = strategy.get("min_sections", 5)
    requirements = strategy.get("section_requirements", {})

    req_list = []
    if requirements.get("comparison_table"):
        req_list.append("비교 표(HTML table)가 포함된 섹션이 최소 1개")
    if requirements.get("faq"):
        req_list.append("FAQ 섹션 (Q&A 3~5개)")
    if requirements.get("summary"):
        req_list.append("마무리/정리 섹션")

    system = f"""당신은 블로그 글 구조 설계 전문가입니다.
리서치 결과를 바탕으로 블로그 글의 아웃라인을 작성하세요.

규칙:
- H2 섹션 최소 {min_sections}개
- 각 H2 아래에 다룰 핵심 포인트 2~4개
- 필수 포함: {', '.join(req_list) if req_list else '없음'}
- 각 섹션에 포함할 구체적 데이터 유형 명시
- 페르소나: {blog_context.get('persona', '블로거')}
- 말투: {blog_context.get('ending_form', '~합니다')}
- 목적: {purpose}

{strategy.get('system_addendum', '')}

JSON으로 응답:
{{
  "title_suggestion": "SEO 최적화된 제목 제안 (2026년 기준)",
  "sections": [
    {{
      "h2": "섹션 제목 (키워드 포함)",
      "h3s": ["소제목1", "소제목2"],
      "key_points": ["이 섹션에서 반드시 다룰 내용"],
      "required_elements": ["table", "faq", "blockquote", "ul" 등 필요한 HTML 요소],
      "target_chars": 이 섹션의 목표 글자수(정수)
    }}
  ],
  "total_target_chars": 전체 목표 글자수(정수),
  "tags_suggestion": ["태그1", "태그2", "태그3", "태그4", "태그5"]
}}"""

    user = f"""키워드: {keyword}

리서치 결과:
{json.dumps(research, ensure_ascii=False)}"""

    return _call_gpt(client, [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=CONTENT_OUTLINE_TOKENS, temperature=0.5)


def step3_generate_section(
    client, keyword: str, section: dict, section_index: int,
    total_sections: int, previous_summaries: list[str],
    blog_context: dict, strategy: dict,
) -> tuple[str, str, int]:
    """Step 3: 개별 섹션 본문 생성.

    Returns: (section_html, section_summary, tokens_used)
    """
    prev_context = ""
    if previous_summaries:
        prev_context = "\n\n이전 섹션 요약 (중복 내용 피하고 자연스럽게 이어서 작성):\n"
        for i, summary in enumerate(previous_summaries):
            prev_context += f"- 섹션 {i + 1}: {summary}\n"

    required = section.get("required_elements", [])
    required_str = ""
    if required:
        required_str = f"\n이 섹션에 반드시 포함: {', '.join(required)}"

    target_chars = section.get("target_chars", 500)

    system = f"""당신은 "{blog_context.get('persona', '블로거')}"입니다.
{blog_context.get('description', '')}

블로그 글의 한 섹션을 작성합니다. (전체 {total_sections}개 섹션 중 {section_index + 1}번째)

규칙:
- 말투: {blog_context.get('ending_form', '~합니다')}
- 스타일: {blog_context.get('style', 'professional')}
- **이 섹션만 작성** — 다른 섹션 내용을 포함하지 마세요
- **목표 글자수: {target_chars}자 이상** (너무 짧으면 불합격)
- HTML 태그 사용: <h2>, <h3>, <p>, <ul>, <ol>, <strong>, <em>, <table>, <blockquote>
- <h2>로 시작하고, 그 아래 내용을 충분히 작성
- **구체적 수치, 실제 이름** 사용 (가명/모호한 표현 금지)
- 이전 섹션과 자연스럽게 연결되는 도입부 포함
- 마지막에 다음 섹션으로 이어지는 연결 문장 포함{required_str}

{strategy.get('system_addendum', '')}

JSON으로 응답:
{{
  "html": "이 섹션의 HTML 본문 (<h2>로 시작)",
  "summary": "이 섹션에서 다룬 내용 1~2문장 요약 (다음 섹션 컨텍스트용)"
}}"""

    key_points_str = "\n".join(f"  - {p}" for p in section.get("key_points", []))
    h3s_str = ", ".join(section.get("h3s", []))

    user = f"""키워드: {keyword}

이 섹션 정보:
- H2: {section['h2']}
- H3: {h3s_str}
- 핵심 포인트:
{key_points_str}
- 목표 글자수: {target_chars}자 이상{prev_context}"""

    result, tokens = _call_gpt(client, [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=CONTENT_MAX_TOKENS, temperature=0.7)

    html = result.get("html", "") if isinstance(result, dict) else ""
    summary = result.get("summary", "") if isinstance(result, dict) else ""

    return html, summary, tokens


def step3_generate_all_sections(
    client, keyword: str, outline: dict,
    blog_context: dict, strategy: dict,
) -> tuple[list[str], int]:
    """Step 3 전체: 모든 섹션을 순차 생성하며 이전 요약을 전달."""
    sections = outline.get("sections", [])
    total = len(sections)
    section_htmls = []
    previous_summaries = []
    total_tokens = 0

    for i, section in enumerate(sections):
        logger.info(f"  섹션 {i + 1}/{total}: {section.get('h2', '?')}")

        html, summary, tokens = step3_generate_section(
            client, keyword, section, i, total,
            previous_summaries, blog_context, strategy,
        )
        total_tokens += tokens

        # 섹션 품질 체크 — 너무 짧으면 1회 재시도
        text = re.sub(r'<[^>]+>', '', html).strip()
        target = section.get("target_chars", 400)
        if len(text) < target * 0.6 and CONTENT_MAX_RETRIES > 0:
            logger.info(f"  섹션 {i + 1} 글자수 부족 ({len(text)}/{target}자), 재시도")
            html2, summary2, tokens2 = step3_generate_section(
                client, keyword, section, i, total,
                previous_summaries, blog_context, strategy,
            )
            total_tokens += tokens2
            text2 = re.sub(r'<[^>]+>', '', html2).strip()
            if len(text2) > len(text):
                html, summary = html2, summary2

        section_htmls.append(html)
        previous_summaries.append(summary)

    return section_htmls, total_tokens


def step4_assemble(section_htmls: list[str]) -> str:
    """Step 4: 섹션 HTML을 하나의 본문으로 조립."""
    valid = [h for h in section_htmls if h.strip()]
    assembled = "\n\n".join(valid)
    assembled = re.sub(r'(<h2[^>]*>[^<]+</h2>)\s*\1', r'\1', assembled)
    assembled = re.sub(r'<(p|div|span)>\s*</\1>', '', assembled)
    return assembled


def step5_quality_check(html: str, keyword: str, purpose: str) -> dict:
    """Step 5: 전체 품질 검증."""
    text_content = re.sub(r'<[^>]+>', '', html).strip()
    char_count = len(text_content)
    h2_count = len(re.findall(r'<h2', html, re.I))

    min_chars = CONTENT_MIN_CHARS.get(purpose, 3000)
    threshold = CONTENT_QUALITY_THRESHOLD.get(purpose, 80)

    keyword_words = [w for w in keyword.lower().split() if len(w) > 1]
    text_lower = text_content.lower()
    if keyword_words:
        word_matches = sum(1 for w in keyword_words if w in text_lower)
        keyword_ratio = word_matches / len(keyword_words)
    else:
        keyword_ratio = 1.0 if keyword.lower() in text_lower else 0.0

    score = 0
    suggestions = []

    # 글자수 (30점)
    if char_count >= min_chars:
        score += 30
    elif char_count >= min_chars * 0.8:
        score += 20
    else:
        score += 10
        suggestions.append(f"현재 {char_count}자 — 최소 {min_chars}자 이상 필요")

    # H2 구조 (20점)
    if h2_count >= 5:
        score += 20
    elif h2_count >= 3:
        score += 15
    else:
        score += 5
        suggestions.append(f"H2 {h2_count}개 — 5개 이상 권장")

    # 키워드 반영률 (20점)
    if keyword_ratio >= 0.8:
        score += 20
    elif keyword_ratio >= 0.5:
        score += 10
    else:
        score += 5
        suggestions.append(f"키워드 '{keyword}' 반영률 {keyword_ratio:.0%}")

    # 목록 사용 (15점)
    if len(re.findall(r'<(ul|ol)', html, re.I)) >= 1:
        score += 15
    else:
        suggestions.append("목록(ul/ol) 사용 권장")

    # 마무리/요약 (15점)
    if re.search(r'(마무리|정리|요약|결론|Conclusion|Summary|FAQ)', html, re.I):
        score += 15
    else:
        suggestions.append("마무리/요약 섹션 추가 권장")

    return {
        "score": score,
        "passed": score >= threshold,
        "threshold": threshold,
        "char_count": char_count,
        "h2_count": h2_count,
        "keyword_ratio": keyword_ratio,
        "suggestions": suggestions,
    }


def generate_meta(client, keyword: str, html: str, outline: dict, blog_context: dict) -> tuple[dict, int]:
    """조립된 본문을 보고 최종 제목 + 태그 + 메타 디스크립션 생성."""
    text_preview = re.sub(r'<[^>]+>', '', html).strip()[:1000]

    # 섹션별 핵심 내용을 태그 힌트로 추출
    sections = outline.get("sections", [])
    section_hints = []
    for s in sections:
        h2 = s.get("h2", "")
        points = s.get("key_points", [])
        section_hints.append(f"- {h2}: {', '.join(points[:3])}")
    section_context = "\n".join(section_hints) if section_hints else "없음"
    num_sections = len(sections)

    system = f"""블로그 글의 제목, 태그, 메타 디스크립션을 작성하세요.

규칙:
- 제목: SEO 최적화, 키워드를 앞쪽에 배치, 2026년 기준, 클릭을 유도하는 제목
- 메타 디스크립션: 150자 이내, 검색 결과에서 클릭을 유도하는 요약
- 페르소나: {blog_context.get('persona', '블로거')}

### 태그 작성 규칙 (매우 중요)
- **각 섹션에서 최소 1개씩** 고유 태그를 뽑아 총 10~15개 작성
- 이 글은 {num_sections}개 섹션으로 구성 — 섹션별 핵심 내용에서 태그를 추출하세요
- **이 글에만 해당하는 고유한 롱테일 태그** 위주로 작성
- 태그는 검색 유입 경로 — 사용자가 실제로 검색할 만한 3~6어절 구체적 문구
- 본문에서 다루는 **구체적 제품명, 수치, 방법론, 증상명** 등을 태그에 반영
- 금지: "건강", "다이어트", "추천", "정보", "방법" 같은 1~2어절 범용 태그
- 금지: 블로그 내 다른 글에서도 쓸 수 있는 범용적인 태그
- 좋은 예: "족저근막염 스트레칭 방법", "RTG오메가3 효능 부작용", "에어프라이어 고구마 시간 온도"
- 나쁜 예: "건강", "오메가3", "에어프라이어"

JSON으로 응답:
{{
  "title": "최종 제목",
  "tags": ["구체적태그1", "구체적태그2", ...],
  "meta_description": "메타 디스크립션"
}}"""

    user = f"""키워드: {keyword}

아웃라인 제목 제안: {outline.get('title_suggestion', '')}

섹션별 핵심 내용 (각 섹션에서 최소 1개 태그 추출):
{section_context}

본문 미리보기:
{text_preview}"""

    return _call_gpt(client, [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], max_tokens=CONTENT_META_TOKENS, temperature=0.5)


def run_pipeline(keyword: str, blog: dict, purpose: str) -> dict:
    """콘텐츠 생성 파이프라인 전체 실행.

    Returns:
        {
            "success": bool,
            "title": str,
            "html": str,
            "tags": list[str],
            "meta_description": str,
            "quality_score": int,
            "quality_passed": bool,
            "total_tokens": int,
            "pipeline_detail": dict,
        }
    """
    client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    blog_context = {
        "persona": blog.get("persona", "블로거"),
        "description": blog.get("description", ""),
        "style": blog.get("style", "professional"),
        "ending_form": blog.get("ending_form", "~합니다"),
        "target_audience": blog.get("target_audience", "일반 독자"),
        "categories": ", ".join(blog.get("categories", [])),
        "voice": blog.get("voice") or {},
    }

    strategy = get_content_strategy(purpose)
    total_tokens = 0

    for attempt in range(CONTENT_PIPELINE_MAX_RETRIES + 1):
        logger.info(f"파이프라인 시도 {attempt + 1}/{CONTENT_PIPELINE_MAX_RETRIES + 1}")

        try:
            # Step 1: 리서치
            logger.info("  Step 1: 리서치")
            research, t1 = step1_research(client, keyword, purpose, blog_context)
            total_tokens += t1
            if isinstance(research, dict) and research.get("error"):
                logger.warning(f"  리서치 실패: {research}")
                continue

            # Step 2: 아웃라인
            logger.info("  Step 2: 아웃라인")
            outline, t2 = step2_outline(client, keyword, research, purpose, blog_context, strategy)
            total_tokens += t2
            if isinstance(outline, dict) and outline.get("error"):
                logger.warning(f"  아웃라인 실패: {outline}")
                continue
            if not outline.get("sections"):
                logger.warning("  아웃라인에 sections 없음")
                continue

            # Step 3: 섹션별 생성
            logger.info(f"  Step 3: 섹션별 생성 ({len(outline['sections'])}개)")
            section_htmls, t3 = step3_generate_all_sections(
                client, keyword, outline, blog_context, strategy,
            )
            total_tokens += t3

            # Step 4: 조립
            logger.info("  Step 4: 조립")
            assembled_html = step4_assemble(section_htmls)

            # Step 5: 품질 검증
            logger.info("  Step 5: 품질 검증")
            quality = step5_quality_check(assembled_html, keyword, purpose)
            logger.info(f"  품질: {quality['score']}/100 ({'PASS' if quality['passed'] else 'FAIL'}) — {quality['char_count']}자, H2 {quality['h2_count']}개")

            if not quality["passed"] and attempt < CONTENT_PIPELINE_MAX_RETRIES:
                logger.info(f"  품질 미달, 파이프라인 재시도 (suggestions: {quality['suggestions']})")
                continue

            # 메타 생성 (품질 통과 또는 마지막 시도)
            logger.info("  메타 생성")
            meta, t_meta = generate_meta(client, keyword, assembled_html, outline, blog_context)
            total_tokens += t_meta

            title = meta.get("title", keyword) if isinstance(meta, dict) else keyword
            tags = meta.get("tags", []) if isinstance(meta, dict) else []
            meta_desc = meta.get("meta_description", "") if isinstance(meta, dict) else ""

            return {
                "success": True,
                "title": title,
                "html": assembled_html,
                "tags": tags,
                "meta_description": meta_desc,
                "quality_score": quality["score"],
                "quality_passed": quality["passed"],
                "total_tokens": total_tokens,
                "pipeline_detail": {
                    "research": research,
                    "outline_sections": len(outline.get("sections", [])),
                    "sections_generated": len(section_htmls),
                    "char_count": quality["char_count"],
                    "h2_count": quality["h2_count"],
                    "attempts": attempt + 1,
                },
            }

        except Exception as e:
            logger.error(f"  파이프라인 오류 (시도 {attempt + 1}): {e}")
            if attempt >= CONTENT_PIPELINE_MAX_RETRIES:
                return {
                    "success": False,
                    "title": keyword,
                    "html": "",
                    "tags": [],
                    "meta_description": "",
                    "quality_score": 0,
                    "quality_passed": False,
                    "total_tokens": total_tokens,
                    "pipeline_detail": {"error": str(e), "attempts": attempt + 1},
                }

    # 모든 재시도 소진
    return {
        "success": False,
        "title": keyword,
        "html": "",
        "tags": [],
        "meta_description": "",
        "quality_score": 0,
        "quality_passed": False,
        "total_tokens": total_tokens,
        "pipeline_detail": {"error": "all retries exhausted", "attempts": CONTENT_PIPELINE_MAX_RETRIES + 1},
    }
