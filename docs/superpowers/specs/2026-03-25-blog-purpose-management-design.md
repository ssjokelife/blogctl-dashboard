# 블로그 목적별 관리 전략 설계

> 블로그의 수익 모델(목적)에 따라 관리 지표, AI 전략, UI를 분기하는 기능

## 배경

현재 모든 블로그가 동일한 지표와 동일한 AI 전략으로 관리되고 있다. 그러나 애드센스 수익 블로그, 쿠팡 파트너스 블로그, 네이버 체험단 블로그는 각각 성공 지표와 콘텐츠 전략이 완전히 다르다. 목적에 맞는 관리를 해야 실질적인 성과를 낼 수 있다.

## 설계 원칙

- 블로그 하나당 목적 하나 (단일 목적)
- 기존 테이블 구조 최소 변경 (`blogs` 테이블에 컬럼 추가)
- 체험단 전용 테이블(`experience_logs`)은 2단계로 미룸
- YAGNI: 지금 필요한 것만 구현

## 목적 타입

| purpose 값 | 한국어명 | 핵심 목표 |
|-------------|---------|-----------|
| `adsense` | 애드센스 수익 | 검색 트래픽 → 광고 클릭 수익 |
| `coupang` | 쿠팡 파트너스 | 상품 리뷰/추천 → 구매 전환 수익 |
| `naver_experience` | 네이버 체험단 | 블로그 지수 관리 → 체험단 선정 |

## 1. 데이터 모델

### 1.1 blogs 테이블 변경

```sql
ALTER TABLE blogs ADD COLUMN purpose text DEFAULT 'adsense'
  CHECK (purpose IN ('adsense', 'coupang', 'naver_experience'));
```

기존 `adapter` 컬럼은 그대로 유지 (발행 어댑터 용도로 별개 역할 가능).

**TypeScript 타입 정의** (`src/lib/types.ts` 또는 `data.ts`):
```ts
export type BlogPurpose = 'adsense' | 'coupang' | 'naver_experience';
```
Blog 인터페이스, API 라우트, 컴포넌트에서 이 타입을 사용.

### 1.2 마이그레이션

마이그레이션 전 실제 데이터 확인 필요:
```sql
-- 사전 확인 쿼리
SELECT id, label, platform, adapter FROM blogs;
```

```sql
-- 기존 데이터 마이그레이션 (실제 데이터 확인 후 조정)
UPDATE blogs SET purpose = 'coupang' WHERE adapter = 'coupang';
UPDATE blogs SET purpose = 'naver_experience' WHERE platform = 'naver';
-- 나머지는 DEFAULT 'adsense'로 처리됨
```

> **주의**: `adapter = 'coupang'`과 `platform = 'naver'`가 실제 데이터와 일치하는지 반드시 확인 후 실행. 불일치 시 blog ID를 직접 지정하여 마이그레이션.

### 1.3 measurements.data jsonb 표준 스키마

목적별로 `measurements.data`에 저장하는 구조를 표준화한다.

> **하위 호환성**: 기존 `measurements.data`는 이미 `adsense.revenue`, `coupang.revenue` 구조를 사용 중 (`getRevenueTrend` 함수 참조). 아래 스키마는 기존 구조를 확장하는 것이며, 기존 필드는 그대로 유지된다. 새 필드(`pageviews`, `clicks` 등)는 점진적으로 추가.

**adsense:**
```jsonc
{
  "adsense": {
    "pageviews": 1200,
    "clicks": 45,
    "ctr": 3.75,        // %
    "rpm": 2800,         // ₩
    "revenue": 3360      // ₩
  }
}
```

**coupang:**
```jsonc
{
  "coupang": {
    "clicks": 320,
    "conversions": 12,
    "conversion_rate": 3.75,  // %
    "revenue": 15600,         // ₩
    "by_category": {
      "가전": { "clicks": 120, "conversions": 5, "revenue": 8000 },
      "생활": { "clicks": 200, "conversions": 7, "revenue": 7600 }
    }
  }
}
```

**naver_experience:**
```jsonc
{
  "naver": {
    "visitors": 850,
    "neighbors": 320,
    "blog_index_estimate": "상위",
    "applications": 3,
    "selections": 1,
    "completions": 1
  }
}
```

## 2. UI 분기

### 2.1 대시보드 (`/`) — 블로그별 목적 맞춤 지표 카드

각 블로그 카드에 purpose에 따른 핵심 지표를 표시한다.

| 목적 | 카드에 표시할 지표 |
|------|-------------------|
| adsense | 오늘 수익(₩), 페이지뷰, CTR, RPM |
| coupang | 오늘 수익(₩), 클릭수, 전환율 |
| naver_experience | 일일 방문자, 이웃수, 블로그 지수 추정 |

### 2.2 블로그 상세 (`/blogs/[blogId]`) — 목적별 전용 섹션

공통 섹션 (모든 목적):
- 페르소나 편집
- 키워드 관리
- 최근 발행 이력

목적별 전용 섹션:

| 목적 | 전용 섹션 |
|------|----------|
| adsense | 수익 추이 차트 (measurements 기반). SEO 분석·인덱싱·검색순위는 데이터 수집 파이프라인 구축 후 추가 |
| coupang | 클릭/수익 추이 차트 (measurements 기반). 카테고리별 성과는 by_category 데이터 수집 후 추가 |
| naver_experience | 방문자/이웃 추이 (measurements 기반). 포스팅 빈도는 publish_logs에서 계산 |

> **1단계 범위**: 현재 measurements에 이미 수집 중인 데이터(revenue, clicks)로 차트를 구성. 아직 수집하지 않는 지표(검색순위, CTR, 전환율 등)는 UI에 "데이터 없음" 또는 수동 입력 안내를 표시.

### 2.3 설정 (`/settings`) & 온보딩 (`/onboarding`)

- 블로그 추가/편집 폼에 purpose 드롭다운 추가
- 선택지: "애드센스 수익", "쿠팡 파트너스", "네이버 체험단"
- 온보딩 플로우에도 purpose 선택 단계 포함

### 2.4 컴포넌트 구조

```
src/components/purpose/
  adsense-metrics.tsx      — 애드센스 지표 카드 & 차트
  coupang-metrics.tsx      — 쿠팡 지표 카드 & 차트
  naver-metrics.tsx        — 네이버 체험단 지표 카드 & 차트
```

블로그 상세 페이지에서 `purpose` 값에 따라 조건부 렌더링:

```tsx
{blog.purpose === 'adsense' && <AdsenseMetrics blog={blog} data={measurements} />}
{blog.purpose === 'coupang' && <CoupangMetrics blog={blog} data={measurements} />}
{blog.purpose === 'naver_experience' && <NaverMetrics blog={blog} data={measurements} />}
```

## 3. AI 전략 분기

### 3.1 콘텐츠 생성

콘텐츠 생성은 두 경로로 실행된다:
- **Next.js API** (`/api/publish`): publish_job 레코드 생성만 담당
- **Python worker** (`worker/main.py`, `worker/daily_run.py`): 실제 GPT 호출 및 프롬프트 조립

목적별 프롬프트 전략은 **Python worker에서 적용**한다. worker가 blog 정보를 조회할 때 `purpose` 필드를 함께 읽어 프롬프트를 분기한다.

| 목적 | 프롬프트 전략 |
|------|-------------|
| adsense | SEO 최적화, 검색 의도 충족, 긴 체류시간 유도, 광고 배치 공간 확보 |
| coupang | 상품 비교/추천 구조, 구매 결정 도움, CTA 배치, 쿠팡 링크 삽입 포인트 명시 |
| naver_experience | 리뷰 톤, 체험 스토리텔링, 사진 배치 가이드, 네이버 SEO (제목 키워드 배치) |

### 3.2 키워드 추천 (`/api/keywords/suggest`)

| 목적 | 키워드 선정 기준 |
|------|----------------|
| adsense | 검색량 높은 정보성 키워드, 경쟁 난이도 낮은 롱테일 |
| coupang | 구매 의도 키워드 ("추천", "비교", "순위", "가성비") |
| naver_experience | 체험단 카테고리 관련 키워드, 블로그 지수 올리기에 유리한 키워드 |

### 3.3 프롬프트 모듈 구조

**TypeScript (키워드 추천용 — Next.js에서 실행):**
```
src/lib/prompts/
  adsense.ts              — 애드센스 키워드 추천 전략
  coupang.ts              — 쿠팡 파트너스 키워드 추천 전략
  naver-experience.ts     — 네이버 체험단 키워드 추천 전략
  index.ts                — purpose 값으로 전략을 선택하는 라우터
```

**Python (콘텐츠 생성용 — worker에서 실행):**
```
worker/
  prompts/
    adsense.py            — 애드센스 콘텐츠 생성 프롬프트
    coupang.py            — 쿠팡 파트너스 콘텐츠 생성 프롬프트
    naver_experience.py   — 네이버 체험단 콘텐츠 생성 프롬프트
    __init__.py           — purpose 값으로 전략을 선택하는 라우터
```

라우터 예시 (Python):
```python
def get_content_strategy(purpose: str) -> dict:
    strategies = {
        'coupang': coupang_strategy,
        'naver_experience': naver_experience_strategy,
    }
    return strategies.get(purpose, adsense_strategy)
```

## 4. 영향 범위

| 파일/영역 | 변경 내용 |
|-----------|----------|
| `supabase/` | 마이그레이션 SQL (purpose 컬럼 추가) |
| `src/lib/data.ts` | Blog 타입에 purpose 필드 추가, 지표 조회 함수에 purpose 고려 |
| `src/app/page.tsx` | 대시보드 블로그 카드에 목적별 지표 표시 |
| `src/app/blogs/[blogId]/page.tsx` | 목적별 전용 섹션 렌더링 |
| `src/app/settings/page.tsx` | 블로그 폼에 purpose 선택 추가 |
| `src/app/settings/actions.ts` | 블로그 추가/수정 시 purpose 저장 |
| `src/app/onboarding/page.tsx` | purpose 선택 단계 추가 |
| `src/app/api/keywords/suggest/route.ts` | 목적별 키워드 추천 기준 적용 |
| `src/components/purpose/` | 새 컴포넌트 3개 (adsense, coupang, naver) |
| `src/lib/prompts/` | 새 모듈 4개 — 키워드 추천 전략 (TypeScript) |
| `worker/main.py` | blog.purpose 조회 + 목적별 프롬프트 분기 |
| `worker/daily_run.py` | 동일 — 일일 자동 발행에도 purpose 반영 |
| `worker/prompts/` | 새 모듈 4개 — 콘텐츠 생성 전략 (Python) |

## 5. 범위 밖 (2단계)

- `experience_logs` 테이블 (체험단 신청/선정 이력 관리)
- 체험단 캘린더 UI
- 목적 변경 시 데이터 마이그레이션 가이드
- 복합 목적 (주/부 목적) 지원
