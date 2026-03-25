# Blog Purpose-Based Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Differentiate blog management (metrics, AI strategy, UI) by monetization purpose (adsense, coupang, naver_experience).

**Architecture:** Add `purpose` column to `blogs` table. Branch dashboard metrics, blog detail sections, AI prompts (TypeScript for keyword suggest, Python for content generation) based on `purpose` value. Minimal schema change, maximum behavioral differentiation.

**Tech Stack:** Next.js 16 (App Router), Supabase Postgres, TypeScript, Python (worker), OpenAI GPT-4o, shadcn/ui, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-25-blog-purpose-management-design.md`

---

## File Structure

### New files
- `scripts/migrate-purpose.sql` — DB migration for purpose column
- `src/lib/purpose.ts` — Purpose type definition + labels + utilities
- `src/lib/prompts/adsense.ts` — AdSense keyword suggest strategy
- `src/lib/prompts/coupang.ts` — Coupang keyword suggest strategy
- `src/lib/prompts/naver-experience.ts` — Naver experience keyword suggest strategy
- `src/lib/prompts/index.ts` — Purpose-based strategy router
- `src/components/purpose/adsense-metrics.tsx` — AdSense metrics card
- `src/components/purpose/coupang-metrics.tsx` — Coupang metrics card
- `src/components/purpose/naver-metrics.tsx` — Naver experience metrics card
- `worker/prompts/__init__.py` — Python purpose-based strategy router
- `worker/prompts/adsense.py` — AdSense content generation strategy
- `worker/prompts/coupang.py` — Coupang content generation strategy
- `worker/prompts/naver_experience.py` — Naver experience content generation strategy

### Modified files
- `src/lib/data.ts` — Add `purpose` to Blog type and `getBlogList` query
- `src/app/settings/page.tsx` — Add purpose dropdown to blog table and add form
- `src/app/settings/actions.ts` — Save purpose field in addBlog
- `src/app/onboarding/page.tsx` — Add purpose selection
- `src/app/onboarding/actions.ts` — Save purpose in onboarding addBlog
- `src/app/blogs/[blogId]/page.tsx` — Show purpose badge, render purpose-specific metrics
- `src/app/page.tsx` — Show purpose badge per blog in dashboard table
- `src/app/api/keywords/suggest/route.ts` — Use purpose-based keyword strategy
- `worker/main.py` — Use purpose-based content generation strategy

---

## Task 1: DB Migration + Purpose Type

**Files:**
- Create: `scripts/migrate-purpose.sql`
- Create: `src/lib/purpose.ts`

- [ ] **Step 1: Create migration SQL**

```sql
-- scripts/migrate-purpose.sql
-- 1. Add purpose column
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'adsense'
  CHECK (purpose IN ('adsense', 'coupang', 'naver_experience'));

-- 2. Migrate existing data (verify with SELECT first)
-- SELECT id, label, platform, adapter FROM blogs;
UPDATE blogs SET purpose = 'coupang' WHERE adapter = 'coupang';
UPDATE blogs SET purpose = 'naver_experience' WHERE platform = 'naver';
```

- [ ] **Step 2: Create TypeScript purpose type and utilities**

```ts
// src/lib/purpose.ts
export type BlogPurpose = 'adsense' | 'coupang' | 'naver_experience'

export const PURPOSE_LABELS: Record<BlogPurpose, string> = {
  adsense: '애드센스',
  coupang: '쿠팡 파트너스',
  naver_experience: '네이버 체험단',
}

export const PURPOSE_COLORS: Record<BlogPurpose, string> = {
  adsense: 'bg-blue-100 text-blue-700',
  coupang: 'bg-orange-100 text-orange-700',
  naver_experience: 'bg-green-100 text-green-700',
}
```

- [ ] **Step 3: Update data.ts — add purpose to getBlogList**

In `src/lib/data.ts`, update `getBlogList`:
- Add `purpose` to the select query: `"id, label, url, platform, adapter, purpose"`
- Add `purpose` to the return type: `Record<string, { label: string; url: string; platform: string; adapter: string; purpose: string }>`
- Add `purpose: b.purpose` to the reduce callback object:
```ts
acc[b.id] = { label: b.label, url: b.url, platform: b.platform, adapter: b.adapter, purpose: b.purpose };
```

- [ ] **Step 4: Run migration on Supabase**

Run: `scripts/migrate-purpose.sql` in Supabase SQL editor
Expected: `purpose` column added, existing blogs migrated

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-purpose.sql src/lib/purpose.ts src/lib/data.ts
git commit -m "feat: add blog purpose type and DB migration"
```

---

## Task 2: Settings — Purpose Selection in Blog Management

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/settings/actions.ts`

- [ ] **Step 1: Update addBlog action to save purpose**

In `src/app/settings/actions.ts`, add purpose field:

```ts
// After line 15 (const platform = ...)
const purpose = (formData.get('purpose') as string) || 'adsense'
```

Add `purpose` to the upsert object (after `url_pattern`):
```ts
purpose,
```

- [ ] **Step 2: Add purpose column to blog table in settings page**

In `src/app/settings/page.tsx`:
- Add a new `<TableHead>` "목적" after "플랫폼"
- Add a new `<TableCell>` showing the purpose badge:
```tsx
import { PURPOSE_LABELS, PURPOSE_COLORS } from '@/lib/purpose'
import type { BlogPurpose } from '@/lib/purpose'
// In table cell:
<TableCell>
  <Badge className={PURPOSE_COLORS[(blog.purpose || 'adsense') as BlogPurpose]}>
    {PURPOSE_LABELS[(blog.purpose || 'adsense') as BlogPurpose]}
  </Badge>
</TableCell>
```

- [ ] **Step 3: Add purpose dropdown to add blog form**

In `src/app/settings/page.tsx`, add a purpose select field in the add blog form (between platform and URL):

```tsx
<div className="space-y-1">
  <label htmlFor="purpose" className="text-xs text-gray-500">목적</label>
  <select
    id="purpose"
    name="purpose"
    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
  >
    <option value="adsense">애드센스 수익</option>
    <option value="coupang">쿠팡 파트너스</option>
    <option value="naver_experience">네이버 체험단</option>
  </select>
</div>
```

Update grid to `md:grid-cols-6` to accommodate the new column.

- [ ] **Step 4: Verify in dev server**

Run: `npm run dev`
Expected: Settings page shows purpose column in blog table and purpose dropdown in add form

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx src/app/settings/actions.ts
git commit -m "feat: add purpose selection to blog settings"
```

---

## Task 3: Onboarding — Purpose Selection

**Files:**
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/onboarding/actions.ts`

- [ ] **Step 1: Add purpose select to onboarding form**

In `src/app/onboarding/page.tsx`, add a purpose field after the platform select:

```tsx
<div className="space-y-2">
  <label htmlFor="purpose" className="text-sm font-medium text-gray-700">블로그 목적</label>
  <select
    id="purpose"
    name="purpose"
    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
  >
    <option value="adsense">애드센스 수익</option>
    <option value="coupang">쿠팡 파트너스</option>
    <option value="naver_experience">네이버 체험단</option>
  </select>
  <p className="text-xs text-gray-400">블로그의 주 수익 모델을 선택하세요.</p>
</div>
```

- [ ] **Step 2: Update onboarding addBlog action to save purpose**

In `src/app/onboarding/actions.ts`, check if it delegates to the settings `addBlog` or has its own logic. Add `purpose` field handling accordingly — same pattern as Task 2 Step 1.

- [ ] **Step 3: Verify onboarding flow**

Run: `npm run dev`, navigate to `/onboarding`
Expected: Purpose dropdown appears in registration form

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/page.tsx src/app/onboarding/actions.ts
git commit -m "feat: add purpose selection to onboarding"
```

---

## Task 4: Dashboard — Purpose Badge per Blog

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add purpose badge to blog table rows**

In `src/app/page.tsx`, import purpose utilities:
```tsx
import { PURPOSE_LABELS, PURPOSE_COLORS } from '@/lib/purpose'
import type { BlogPurpose } from '@/lib/purpose'
```

In the "블로그별 발행 현황" table, add a `<TableHead>목적</TableHead>` column after "블로그", and a corresponding cell:
```tsx
<TableCell>
  <Badge className={PURPOSE_COLORS[(info?.purpose || 'adsense') as BlogPurpose]}>
    {PURPOSE_LABELS[(info?.purpose || 'adsense') as BlogPurpose]}
  </Badge>
</TableCell>
```

- [ ] **Step 2: Verify dashboard**

Run: `npm run dev`
Expected: Blog table shows purpose badge next to each blog

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: show blog purpose badge on dashboard"
```

---

## Task 5: Blog Detail — Purpose Badge + Metrics Section

**Files:**
- Modify: `src/app/blogs/[blogId]/page.tsx`
- Create: `src/components/purpose/adsense-metrics.tsx`
- Create: `src/components/purpose/coupang-metrics.tsx`
- Create: `src/components/purpose/naver-metrics.tsx`

- [ ] **Step 1: Add purpose badge to blog detail header**

In `src/app/blogs/[blogId]/page.tsx`, replace the existing coupang-only badge logic (line 53):
```tsx
{blog.adapter === 'coupang' && <Badge className="bg-orange-100 text-orange-700">쿠팡</Badge>}
```
with:
```tsx
import { PURPOSE_LABELS, PURPOSE_COLORS } from '@/lib/purpose'
import type { BlogPurpose } from '@/lib/purpose'
// ...
<Badge className={PURPOSE_COLORS[(blog.purpose || 'adsense') as BlogPurpose]}>
  {PURPOSE_LABELS[(blog.purpose || 'adsense') as BlogPurpose]}
</Badge>
```

- [ ] **Step 2: Create AdSense metrics component**

```tsx
// src/components/purpose/adsense-metrics.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AdsenseMetricsProps {
  data: Record<string, unknown> | null
}

export function AdsenseMetrics({ data }: AdsenseMetricsProps) {
  const adsense = (data as Record<string, Record<string, number>> | null)?.adsense
  if (!adsense) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">애드센스 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">측정 데이터가 없습니다. measurements에 adsense 데이터가 수집되면 여기에 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">애드센스 지표</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">수익</p>
            <p className="text-lg font-bold">₩{(adsense.revenue || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">페이지뷰</p>
            <p className="text-lg font-bold">{(adsense.pageviews || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">CTR</p>
            <p className="text-lg font-bold">{adsense.ctr || 0}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">RPM</p>
            <p className="text-lg font-bold">₩{(adsense.rpm || 0).toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create Coupang metrics component**

```tsx
// src/components/purpose/coupang-metrics.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CoupangMetricsProps {
  data: Record<string, unknown> | null
}

export function CoupangMetrics({ data }: CoupangMetricsProps) {
  const coupang = (data as Record<string, Record<string, number>> | null)?.coupang
  if (!coupang) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">쿠팡 파트너스 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">측정 데이터가 없습니다. measurements에 coupang 데이터가 수집되면 여기에 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">쿠팡 파트너스 지표</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500">수익</p>
            <p className="text-lg font-bold">₩{(coupang.revenue || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">클릭수</p>
            <p className="text-lg font-bold">{(coupang.clicks || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">전환율</p>
            <p className="text-lg font-bold">{coupang.conversion_rate || 0}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Create Naver metrics component**

```tsx
// src/components/purpose/naver-metrics.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface NaverMetricsProps {
  data: Record<string, unknown> | null
}

export function NaverMetrics({ data }: NaverMetricsProps) {
  const naver = (data as Record<string, Record<string, number | string>> | null)?.naver
  if (!naver) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">네이버 체험단 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">측정 데이터가 없습니다. measurements에 naver 데이터가 수집되면 여기에 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">네이버 체험단 지표</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">일일 방문자</p>
            <p className="text-lg font-bold">{(naver.visitors as number || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">이웃수</p>
            <p className="text-lg font-bold">{(naver.neighbors as number || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">블로그 지수</p>
            <p className="text-lg font-bold">{naver.blog_index_estimate || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">체험단 선정</p>
            <p className="text-lg font-bold">{naver.selections || 0}건</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Integrate metrics into blog detail page**

In `src/app/blogs/[blogId]/page.tsx`, after the 페르소나 Card and before 키워드 관리 Card, add:

```tsx
import { AdsenseMetrics } from '@/components/purpose/adsense-metrics'
import { CoupangMetrics } from '@/components/purpose/coupang-metrics'
import { NaverMetrics } from '@/components/purpose/naver-metrics'
import { getLatestMeasurement } from '@/lib/data'
```

Fetch measurement data (add to the top of the component):
```tsx
const measurement = await getLatestMeasurement()
```

> **Note:** `getLatestMeasurement()` returns global (all-blog) measurement data, not per-blog. The metrics components will display aggregate data. This is a known limitation — per-blog measurements require a separate data collection pipeline (2단계). The "데이터 없음" fallback in each component handles the case where no data exists.

Render purpose-specific metrics section:
```tsx
{/* 목적별 지표 */}
{blog.purpose === 'coupang' && <CoupangMetrics data={measurement?.data} />}
{blog.purpose === 'naver_experience' && <NaverMetrics data={measurement?.data} />}
{(!blog.purpose || blog.purpose === 'adsense') && <AdsenseMetrics data={measurement?.data} />}
```

- [ ] **Step 6: Verify blog detail page**

Run: `npm run dev`, navigate to a blog detail page
Expected: Purpose badge in header, purpose-specific metrics card shown

- [ ] **Step 7: Commit**

```bash
git add src/app/blogs/[blogId]/page.tsx src/components/purpose/
git commit -m "feat: add purpose-specific metrics to blog detail page"
```

---

## Task 6: AI Strategy — Keyword Suggest (TypeScript)

**Files:**
- Create: `src/lib/prompts/adsense.ts`
- Create: `src/lib/prompts/coupang.ts`
- Create: `src/lib/prompts/naver-experience.ts`
- Create: `src/lib/prompts/index.ts`
- Modify: `src/app/api/keywords/suggest/route.ts`

- [ ] **Step 1: Create prompt strategy modules**

```ts
// src/lib/prompts/adsense.ts
export const adsenseKeywordStrategy = {
  systemAddendum: `추천 기준:
1. 검색 볼륨이 있고 경쟁이 낮은 롱테일 키워드
2. 정보성 검색 의도 키워드 (how-to, 방법, 뜻, 차이)
3. 기존 발행 글과 겹치지 않는 콘텐츠 갭
4. 광고 단가(CPC)가 높을 것으로 예상되는 주제 우선
5. 검색 의도가 명확한 키워드`,
}
```

```ts
// src/lib/prompts/coupang.ts
export const coupangKeywordStrategy = {
  systemAddendum: `추천 기준:
1. 구매 의도가 포함된 키워드 ("추천", "비교", "순위", "가성비", "인기", "베스트")
2. 상품 리뷰/비교에 적합한 키워드
3. 쿠팡에서 판매되는 상품 카테고리 관련 키워드
4. 전환율이 높은 구체적인 상품명이나 카테고리 키워드
5. 기존 발행 글과 겹치지 않는 콘텐츠 갭`,
}
```

```ts
// src/lib/prompts/naver-experience.ts
export const naverExperienceKeywordStrategy = {
  systemAddendum: `추천 기준:
1. 체험단 모집이 활발한 카테고리 관련 키워드 (맛집, 뷰티, 육아, 생활가전)
2. 네이버 블로그 지수(방문자수) 올리기에 유리한 키워드
3. 리뷰/후기 형식에 적합한 키워드
4. 네이버 검색에서 블로그 탭 상위 노출이 가능한 키워드
5. 기존 발행 글과 겹치지 않는 콘텐츠 갭`,
}
```

```ts
// src/lib/prompts/index.ts
import type { BlogPurpose } from '@/lib/purpose'
import { adsenseKeywordStrategy } from './adsense'
import { coupangKeywordStrategy } from './coupang'
import { naverExperienceKeywordStrategy } from './naver-experience'

const strategies: Record<BlogPurpose, { systemAddendum: string }> = {
  adsense: adsenseKeywordStrategy,
  coupang: coupangKeywordStrategy,
  naver_experience: naverExperienceKeywordStrategy,
}

export function getKeywordStrategy(purpose: string): { systemAddendum: string } {
  return strategies[purpose as BlogPurpose] || strategies.adsense
}
```

- [ ] **Step 2: Update keyword suggest API to use purpose-based strategy**

In `src/app/api/keywords/suggest/route.ts`:

Add import:
```ts
import { getKeywordStrategy } from '@/lib/prompts'
```

After blog is fetched (line 24), get the strategy:
```ts
const strategy = getKeywordStrategy(blog.purpose || 'adsense')
```

Replace the hardcoded system prompt criteria (lines 53-61) with:
```ts
content: `당신은 블로그 키워드 리서치 전문가입니다. 블로그의 페르소나와 기존 콘텐츠를 분석해서 다음에 작성할 키워드를 추천합니다.

${strategy.systemAddendum}

JSON 배열로 응답해주세요. 각 항목: {"keyword": "...", "category": "...", "priority": "high|medium|low", "reason": "추천 이유"}`
```

- [ ] **Step 3: Verify keyword suggest**

Run: `npm run dev`, navigate to a blog detail, click AI 키워드 추천
Expected: Keywords recommended based on blog purpose

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/ src/app/api/keywords/suggest/route.ts
git commit -m "feat: purpose-based keyword suggestion strategy"
```

---

## Task 7: AI Strategy — Content Generation (Python Worker)

**Files:**
- Create: `worker/prompts/__init__.py`
- Create: `worker/prompts/adsense.py`
- Create: `worker/prompts/coupang.py`
- Create: `worker/prompts/naver_experience.py`
- Modify: `worker/main.py`

- [ ] **Step 1: Create Python prompt strategy modules**

```python
# worker/prompts/adsense.py
def get_strategy():
    return {
        "system_addendum": """## 애드센스 최적화 규칙
1. 검색 의도를 정확히 충족하는 깊이 있는 콘텐츠 작성
2. 독자의 체류시간을 늘리는 구조 (목차, 단계별 설명, FAQ)
3. 광고 배치가 자연스러운 문단 구조 (H2 섹션 사이 충분한 텍스트)
4. 내부 링크 유도 문구 포함 ("관련 글:", "더 알아보기:")
5. 최소 2500자 이상으로 상세하게 작성""",
        "quality_threshold": 75,
    }
```

```python
# worker/prompts/coupang.py
def get_strategy():
    return {
        "system_addendum": """## 쿠팡 파트너스 콘텐츠 규칙
1. 제품 리뷰/비교 형식으로 작성
2. 제품의 장단점을 객관적으로 설명
3. 구매 결정에 도움이 되는 비교표, 체크리스트 포함
4. "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다" 문구를 글 마지막에 포함
5. CTA (Call to Action) 문구 자연스럽게 배치""",
        "quality_threshold": 70,
    }
```

```python
# worker/prompts/naver_experience.py
def get_strategy():
    return {
        "system_addendum": """## 네이버 체험단 블로그 규칙
1. 리뷰/후기 톤으로 작성 (직접 체험한 느낌)
2. 사진 배치 가이드 포함: [사진1: 전체 외관], [사진2: 세부], [사진3: 사용 장면] 등
3. 네이버 SEO: 제목에 핵심 키워드를 앞쪽에 배치
4. 긍정적이면서 신뢰할 수 있는 톤 유지
5. 방문자 재방문 유도: "이웃 추가하시면 더 많은 후기를 보실 수 있어요" 등의 문구""",
        "quality_threshold": 70,
    }
```

```python
# worker/prompts/__init__.py
# Worker runs from worker/ directory, so use relative imports
from prompts.adsense import get_strategy as adsense_strategy
from prompts.coupang import get_strategy as coupang_strategy
from prompts.naver_experience import get_strategy as naver_experience_strategy


def get_content_strategy(purpose: str) -> dict:
    strategies = {
        "coupang": coupang_strategy,
        "naver_experience": naver_experience_strategy,
    }
    fn = strategies.get(purpose, adsense_strategy)
    return fn()
```

- [ ] **Step 2: Update worker/main.py generate_content to use purpose strategy**

In `worker/main.py`, in the `generate_content` function:

After line 56 (`adapter = blog.get("adapter", "keyword")`), add:
```python
purpose = blog.get("purpose", "adsense")
```

Import the strategy router at the top of the function (or at module level):
```python
from prompts import get_content_strategy
```

After the voice instructions block (around line 79):

1. **Remove the entire `affiliate` block** (lines 82-89): delete the `affiliate = ""` assignment and the `if adapter == "coupang":` conditional block entirely.

2. **Add purpose-based strategy** in its place:
```python
# 목적별 전략
strategy = get_content_strategy(purpose)
purpose_instructions = strategy["system_addendum"]
quality_threshold = strategy["quality_threshold"]
```

3. **Update the system_prompt f-string** (line 109): replace `{voice_instructions}{affiliate}` with:
```python
{voice_instructions}
{purpose_instructions}
```

4. **Replace the hardcoded threshold** (line 195):
```python
# Before:
threshold = 70 if adapter == "coupang" else 75
# After:
threshold = quality_threshold
```

> **Note:** `worker/daily_run.py`는 `main.py`의 `generate_content`를 호출하므로 별도 수정 불필요. purpose 전략이 자동으로 적용됨.

- [ ] **Step 3: Test worker locally**

Run: `cd worker && python -c "from prompts import get_content_strategy; print(get_content_strategy('coupang'))"`
Expected: Returns dict with `system_addendum` and `quality_threshold`

- [ ] **Step 4: Commit**

```bash
git add worker/prompts/ worker/main.py
git commit -m "feat: purpose-based content generation in Python worker"
```

---

## Task 8: Build Verification + Final Commit

**Files:** None new

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Verify end-to-end in dev**

Run: `npm run dev`
Check:
1. Dashboard — purpose badges on blog table
2. Settings — purpose dropdown in add form, purpose column in table
3. Blog detail — purpose badge, metrics card
4. Keyword suggest — purpose-specific recommendations

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: blog purpose management polish"
```
