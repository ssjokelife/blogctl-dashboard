import { createClient } from "@/lib/supabase/server";

export interface KeywordEntry {
  keyword: string;
  priority: string;
  status: string;
  category?: string;
  published_at?: string;
  prediction?: {
    monthly_search: number;
    difficulty: number;
    expected_clicks_4w: number;
    expected_impressions_4w: number;
    expected_ctr: number;
    expected_rank: number;
    confidence: string;
  };
}

export const BLOG_LABELS: Record<string, string> = {
  jokelife: "조크라이프 (IT)",
  kyeyangdak: "계양닭 (기술)",
  lukulu: "루꾸루 (라이프)",
  lifezig: "직구언니 (쿠팡)",
  rukkuru: "새싹맘 (네이버)",
  moneysave: "머니노트 (재테크)",
  healthnote: "건강노트 (건강)",
  aitoolspick: "AI Tools Pick",
  seasiaguide: "SeAsia Guide",
  codefirst: "CodeFirst",
  saasreview: "SaaS Scout",
  freelancehub: "FreelanceHub",
};

export async function getPublishStats() {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // 블로그별 총 발행 수 (Supabase 기본 1000행 제한 해제)
  const { count } = await supabase
    .from("publish_logs")
    .select("*", { count: "exact", head: true });

  // 전체 데이터를 가져오기 위해 페이지네이션
  const allLogs: { blog_id: string; published_at: string | null }[] = [];
  const pageSize = 1000;
  const totalRows = count || 0;
  for (let offset = 0; offset < totalRows; offset += pageSize) {
    const { data } = await supabase
      .from("publish_logs")
      .select("blog_id, published_at")
      .range(offset, offset + pageSize - 1);
    if (data) allLogs.push(...data);
  }

  const blogCounts: Record<string, { total: number; today: number }> = {};
  let totalPublished = 0;
  let todayPublished = 0;

  for (const log of allLogs || []) {
    const blog = log.blog_id;
    if (!blogCounts[blog]) blogCounts[blog] = { total: 0, today: 0 };
    blogCounts[blog].total++;
    totalPublished++;

    if (log.published_at?.startsWith(today)) {
      blogCounts[blog].today++;
      todayPublished++;
    }
  }

  return { blogCounts, totalPublished, todayPublished };
}

export async function getKeywordPool(blogId: string) {
  const supabase = await createClient();

  const { data: keywords } = await supabase
    .from("keywords")
    .select("*")
    .eq("blog_id", blogId);

  if (!keywords) return null;

  return {
    blog: blogId,
    keywords: keywords.map((k) => ({
      keyword: k.keyword,
      priority: k.priority,
      status: k.status,
      category: k.category,
      published_at: k.published_at,
      note: k.note,
      search_volume: k.search_volume,
      difficulty: k.difficulty,
      verified: k.verified,
      prediction: k.monthly_search
        ? {
            monthly_search: k.monthly_search,
            difficulty: k.difficulty,
            expected_clicks_4w: k.expected_clicks_4w,
            expected_impressions_4w: k.expected_impressions_4w,
            expected_ctr: k.expected_ctr,
            expected_rank: k.expected_rank,
            confidence: k.confidence,
          }
        : undefined,
    })),
    pending: keywords.filter((k) => k.status !== "published").length,
    published: keywords.filter((k) => k.status === "published").length,
  };
}

export async function getAllKeywordStats() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("keywords")
    .select("blog_id, status");

  const stats: Record<string, { pending: number; published: number; total: number }> = {};

  for (const kw of data || []) {
    if (!stats[kw.blog_id]) stats[kw.blog_id] = { pending: 0, published: 0, total: 0 };
    stats[kw.blog_id].total++;
    if (kw.status === "published") stats[kw.blog_id].published++;
    else stats[kw.blog_id].pending++;
  }

  return stats;
}

export async function getLatestMeasurement() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("measurements")
    .select("measured_at, data")
    .order("measured_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  return { date: data.measured_at, data: data.data };
}

export async function getPredictions() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("keywords")
    .select("blog_id, keyword, monthly_search, expected_clicks_4w, expected_impressions_4w, expected_ctr, expected_rank, confidence")
    .not("monthly_search", "is", null);

  return (data || []).map((k) => ({
    blog: k.blog_id,
    keyword: k.keyword,
    monthly_search: k.monthly_search,
    expected_clicks_4w: k.expected_clicks_4w,
    expected_impressions_4w: k.expected_impressions_4w,
    expected_ctr: k.expected_ctr,
    expected_rank: k.expected_rank,
    confidence: k.confidence,
  }));
}

export async function getBlogList() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("blogs")
    .select("id, label, url, platform, adapter, purpose");

  return (data || []).reduce(
    (acc, b) => {
      acc[b.id] = { label: b.label, url: b.url, platform: b.platform, adapter: b.adapter, purpose: b.purpose };
      return acc;
    },
    {} as Record<string, { label: string; url: string; platform: string; adapter: string; purpose: string }>,
  );
}

export async function getDashboardData() {
  const [publishStats, keywordStats, latestMeasurement, predictions, blogList] = await Promise.all([
    getPublishStats(),
    getAllKeywordStats(),
    getLatestMeasurement(),
    getPredictions(),
    getBlogList(),
  ]);

  const topPredictions = [...predictions]
    .sort((a, b) => (b.expected_clicks_4w || 0) - (a.expected_clicks_4w || 0))
    .slice(0, 10);

  return { publishStats, keywordStats, latestMeasurement, topPredictions, blogList };
}

export async function getRecentPublished(limit = 20) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("publish_logs")
    .select("slug, title, url, blog_id, category, tags, published_at")
    .order("published_at", { ascending: false })
    .limit(limit);

  return (data || []).map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    url: entry.url,
    blog: entry.blog_id,
    category: entry.category,
    tags: entry.tags,
    published_at: entry.published_at,
  }));
}

export async function getRevenueTrend(days = 14) {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("measurements")
    .select("measured_at, data")
    .gte("measured_at", since.toISOString().slice(0, 10))
    .order("measured_at", { ascending: true });

  return (data || []).map((m) => {
    const d = (m.data || {}) as Record<string, { revenue?: number }>;
    return {
      date: (m.measured_at as string).slice(5), // MM-DD
      adsense: d.adsense?.revenue || 0,
      coupang: d.coupang?.revenue || 0,
    };
  });
}

export async function getPublishTrend(days = 14) {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("publish_logs")
    .select("published_at")
    .gte("published_at", since.toISOString());

  const counts: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    counts[d.toISOString().slice(0, 10)] = 0;
  }

  for (const log of data || []) {
    const date = log.published_at?.slice(0, 10);
    if (date && counts[date] !== undefined) counts[date]++;
  }

  return Object.entries(counts).map(([date, count]) => ({
    date: date.slice(5), // MM-DD
    count,
  }));
}
