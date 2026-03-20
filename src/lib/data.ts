import fs from "fs";
import path from "path";

// 데이터 경로: Linux FS 우선 (WSL2 성능), Windows FS 폴백
const DATA_DIR = fs.existsSync("/tmp/blogctl-data/publish_log.json")
  ? "/tmp/blogctl-data"
  : path.resolve("/mnt/c/jin/projects/my-resume/blogs/scripts");

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

interface PublishEntry {
  title: string;
  url: string;
  published_at: string;
  blog?: string;
  category?: string;
  tags?: string[];
}

interface BlogConfig {
  blogs: Record<string, {
    url: string;
    platform: string;
    adapter: string;
    schedule_source?: string;
    categories?: string[];
  }>;
}

const POOL_FILES: Record<string, string> = {
  kyeyangdak: "kyeyangdak_keyword_pool.json",
  jokelife: "keyword_pool.json",
  lukulu: "lukulu_keyword_pool.json",
  lifezig: "lifezig_keyword_pool.json",
  rukkuru: "rukkuru_keyword_pool.json",
  moneysave: "moneysave_keyword_pool.json",
  healthnote: "healthnote_keyword_pool.json",
  aitoolspick: "aitoolspick_keyword_pool.json",
  seasiaguide: "seasiaguide_keyword_pool.json",
  codefirst: "codefirst_keyword_pool.json",
  saasreview: "saasreview_keyword_pool.json",
  freelancehub: "freelancehub_keyword_pool.json",
};

const BLOG_URL_MAP: Record<string, string> = {
  kyeyangdak: "kyeyangdak.tistory.com",
  jokelife: "jokelife.tistory.com",
  lukulu: "lukulu.tistory.com",
  lifezig: "lifezig.tistory.com",
  rukkuru: "naver",
  moneysave: "savemoney-note",
  healthnote: "log-memo",
  aitoolspick: "aitoolspick2026",
  seasiaguide: "seasiaguide2026",
  codefirst: "codefirst2026",
  saasreview: "saasscout-review",
  freelancehub: "freelancehub-jin",
};

// Simple in-memory cache (30s TTL)
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function readJson<T>(filename: string): T | null {
  try {
    const now = Date.now();
    const cached = cache.get(filename);
    if (cached && now - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
    const filePath = path.join(DATA_DIR, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as T;
    cache.set(filename, { data: parsed, ts: now });
    return parsed;
  } catch {
    return null;
  }
}

function detectBlog(url: string): string {
  for (const [blog, pattern] of Object.entries(BLOG_URL_MAP)) {
    if (url.includes(pattern)) return blog;
  }
  return "unknown";
}

export function getPublishLog() {
  const data = readJson<{ published: Record<string, PublishEntry>; failed: string[] }>("publish_log.json");
  if (!data) return { published: {}, failed: [] };
  return data;
}

export function getPublishStats() {
  const { published } = getPublishLog();
  const today = new Date().toISOString().split("T")[0];

  const blogCounts: Record<string, { total: number; today: number }> = {};
  let totalPublished = 0;
  let todayPublished = 0;

  for (const [, entry] of Object.entries(published)) {
    if (typeof entry !== "object" || !entry.url) continue;
    const blog = detectBlog(entry.url);
    if (!blogCounts[blog]) blogCounts[blog] = { total: 0, today: 0 };
    blogCounts[blog].total++;
    totalPublished++;

    if (entry.published_at?.startsWith(today)) {
      blogCounts[blog].today++;
      todayPublished++;
    }
  }

  return { blogCounts, totalPublished, todayPublished };
}

export function getKeywordPool(blogId: string) {
  const filename = POOL_FILES[blogId];
  if (!filename) return null;

  const data = readJson<Record<string, unknown>>(filename);
  if (!data) return null;

  const keywords: KeywordEntry[] = [];
  const categories = (data.categories || {}) as Record<string, { keywords?: KeywordEntry[] }>;

  for (const [catName, catData] of Object.entries(categories)) {
    const kws = catData?.keywords || [];
    for (const kw of kws) {
      keywords.push({ ...kw, category: catName } as KeywordEntry & { category: string });
    }
  }

  return {
    blog: blogId,
    keywords,
    pending: keywords.filter((k) => k.status !== "published").length,
    published: keywords.filter((k) => k.status === "published").length,
  };
}

export function getAllKeywordStats() {
  const stats: Record<string, { pending: number; published: number; total: number }> = {};

  for (const blogId of Object.keys(POOL_FILES)) {
    const pool = getKeywordPool(blogId);
    if (pool) {
      stats[blogId] = {
        pending: pool.pending,
        published: pool.published,
        total: pool.keywords.length,
      };
    }
  }

  return stats;
}

export function getMeasurementLog() {
  const data = readJson<Record<string, unknown[]>>("measurement_log.json");
  if (!data) return {};
  return data;
}

export function getLatestMeasurement() {
  const data = getMeasurementLog();
  const dates = Object.keys(data).sort();
  if (dates.length === 0) return null;

  const latestDate = dates[dates.length - 1];
  const entries = data[latestDate] as Record<string, unknown>[];
  if (!entries || entries.length === 0) return null;

  return { date: latestDate, data: entries[0] };
}

export function getPredictions() {
  const data = readJson<{ predictions: Record<string, unknown>[] }>("keyword_predictions.json");
  if (!data) return [];
  return data.predictions || [];
}

export function getDashboardData() {
  const publishStats = getPublishStats();
  const keywordStats = getAllKeywordStats();
  const latestMeasurement = getLatestMeasurement();
  const predictions = getPredictions();

  // Top predictions sorted by expected clicks
  const topPredictions = [...predictions]
    .sort((a, b) => ((b as { expected_clicks_4w?: number }).expected_clicks_4w || 0) - ((a as { expected_clicks_4w?: number }).expected_clicks_4w || 0))
    .slice(0, 10);

  return {
    publishStats,
    keywordStats,
    latestMeasurement,
    topPredictions,
  };
}

export function getRecentPublished(limit = 20) {
  const { published } = getPublishLog();
  const entries = Object.entries(published)
    .filter(([, v]) => typeof v === "object" && v.published_at)
    .map(([slug, entry]) => ({
      slug,
      ...entry,
      blog: detectBlog(entry.url || ""),
    }))
    .sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""))
    .slice(0, limit);

  return entries;
}
