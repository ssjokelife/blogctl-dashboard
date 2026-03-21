/**
 * blog_config.json 페르소나 → Supabase blogs 테이블 마이그레이션
 * 실행: export $(cat .env.local | grep -v '^#' | xargs) && npx tsx scripts/migrate-personas.ts
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const config = JSON.parse(
  fs.readFileSync("/mnt/c/jin/projects/my-resume/blogs/scripts/blog_config.json", "utf-8")
);

async function main() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;
  if (!userId) throw new Error("No user found");
  console.log(`User: ${userId}`);

  for (const [blogId, blog] of Object.entries(config.blogs as Record<string, any>)) {
    const tone = blog.tone || {};
    const voice = tone.voice || {};

    const { error } = await supabase
      .from("blogs")
      .update({
        persona: tone.persona || null,
        description: tone.description || null,
        target_audience: tone.target_audience || null,
        style: tone.style || "professional",
        ending_form: tone.ending_form || "~합니다",
        voice: Object.keys(voice).length > 0 ? voice : {},
        categories: blog.categories || [],
        adapter: blog.adapter || "keyword",
      })
      .eq("id", blogId)
      .eq("user_id", userId);

    if (error) {
      console.log(`  SKIP ${blogId}: ${error.message}`);
    } else {
      console.log(`  OK ${blogId}: ${tone.persona || "(no persona)"}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
