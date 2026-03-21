/**
 * JSON 데이터 → Supabase 마이그레이션 스크립트
 * 실행: npx tsx scripts/migrate-to-supabase.ts
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY. Load .env.local first.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DATA_DIR = path.resolve(process.cwd(), "data");

// 먼저 현재 유저를 찾아야 함 (첫 번째 유저 = 서비스 소유자)
async function getUserId(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  if (!data.users.length) throw new Error("No users found. Login first via the app.");
  const user = data.users[0];
  console.log(`Found user: ${user.email} (${user.id})`);
  return user.id;
}

const BLOG_LABELS: Record<string, string> = {
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

function detectBlog(url: string): string {
  for (const [blog, pattern] of Object.entries(BLOG_URL_MAP)) {
    if (url.includes(pattern)) return blog;
  }
  return "unknown";
}

function readJson<T>(filename: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf-8"));
  } catch {
    return null;
  }
}

async function migrateBlogs(userId: string) {
  console.log("\n--- Migrating blogs ---");
  const rows = Object.entries(BLOG_LABELS).map(([id, label]) => ({
    id,
    user_id: userId,
    label,
    url: BLOG_URL_MAP[id] || "",
    platform: BLOG_URL_MAP[id]?.includes("tistory") ? "tistory" : BLOG_URL_MAP[id]?.includes("naver") ? "naver" : "tistory",
    url_pattern: BLOG_URL_MAP[id] || "",
  }));

  const { error } = await supabase.from("blogs").upsert(rows, { onConflict: "id,user_id" });
  if (error) throw error;
  console.log(`Inserted ${rows.length} blogs`);
}

async function migratePublishLogs(userId: string) {
  console.log("\n--- Migrating publish logs ---");
  const data = readJson<{ published: Record<string, any> }>("publish_log.json");
  if (!data) { console.log("No publish_log.json found"); return; }

  const rows = Object.entries(data.published)
    .filter(([, v]) => typeof v === "object" && v.url)
    .map(([slug, entry]) => ({
      user_id: userId,
      blog_id: detectBlog(entry.url || ""),
      slug,
      title: entry.title || slug,
      url: entry.url || "",
      category: entry.category || null,
      tags: entry.tags || [],
      status: entry.status || "success",
      published_at: entry.published_at || null,
      search_console: entry.search_console || false,
      sns_shared: entry.sns_shared || false,
    }));

  // Insert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("publish_logs").insert(batch);
    if (error) throw error;
    console.log(`  Batch ${i / 500 + 1}: ${batch.length} rows`);
  }
  console.log(`Total: ${rows.length} publish logs`);
}

async function migrateKeywords(userId: string) {
  console.log("\n--- Migrating keywords ---");
  let total = 0;

  for (const [blogId, filename] of Object.entries(POOL_FILES)) {
    const data = readJson<any>(filename);
    if (!data?.categories) continue;

    const rows: any[] = [];
    for (const [catName, catData] of Object.entries(data.categories as Record<string, any>)) {
      const kws = catData?.keywords || [];
      for (const kw of kws) {
        rows.push({
          user_id: userId,
          blog_id: blogId,
          keyword: kw.keyword,
          category: catName,
          priority: kw.priority || "medium",
          status: kw.status || "pending",
          note: kw.note || null,
          search_volume: kw.search_volume || null,
          difficulty: typeof kw.difficulty === "number" ? kw.difficulty : null,
          search_intent: kw.search_intent || null,
          verified: kw.verified || false,
          verified_at: kw.verified_at || null,
          published_at: kw.published_at || null,
        });
      }
    }

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from("keywords").insert(batch);
        if (error) throw error;
      }
      console.log(`  ${blogId}: ${rows.length} keywords`);
      total += rows.length;
    }
  }

  // Merge predictions into keywords
  const predictions = readJson<{ predictions: any[] }>("keyword_predictions.json");
  if (predictions?.predictions) {
    console.log("\n  Merging predictions...");
    for (const pred of predictions.predictions) {
      const { error } = await supabase
        .from("keywords")
        .update({
          monthly_search: pred.monthly_search,
          expected_clicks_4w: pred.expected_clicks_4w,
          expected_impressions_4w: pred.expected_impressions_4w,
          expected_ctr: pred.expected_ctr,
          expected_rank: pred.expected_rank,
          confidence: pred.confidence,
        })
        .eq("user_id", userId)
        .eq("blog_id", pred.blog)
        .eq("keyword", pred.keyword);
      if (error) console.warn(`  Warning: ${pred.keyword} - ${error.message}`);
    }
    console.log(`  Merged ${predictions.predictions.length} predictions`);
  }

  console.log(`Total: ${total} keywords`);
}

async function migrateMeasurements(userId: string) {
  console.log("\n--- Migrating measurements ---");
  const data = readJson<Record<string, any[]>>("measurement_log.json");
  if (!data) { console.log("No measurement_log.json found"); return; }

  const rows = Object.entries(data).map(([date, entries]) => ({
    user_id: userId,
    measured_at: date,
    data: entries[0] || {},
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("measurements").insert(batch);
    if (error) throw error;
    console.log(`  Batch ${i / 500 + 1}: ${batch.length} rows`);
  }
  console.log(`Total: ${rows.length} measurements`);
}

async function main() {
  console.log("=== BlogCtl Data Migration ===");
  console.log(`Supabase: ${SUPABASE_URL}`);

  const userId = await getUserId();

  await migrateBlogs(userId);
  await migratePublishLogs(userId);
  await migrateKeywords(userId);
  await migrateMeasurements(userId);

  console.log("\n=== Migration Complete ===");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
