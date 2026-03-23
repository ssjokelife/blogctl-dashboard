import { getAllKeywordStats, getKeywordPool, getBlogList } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PLATFORM_LABELS: Record<string, string> = {
  tistory: "T",
  naver: "N",
  wordpress: "WP",
  blogger: "BG",
  hashnode: "HN",
  devto: "DV",
};

const PLATFORM_COLORS: Record<string, string> = {
  tistory: "bg-orange-100 text-orange-700",
  naver: "bg-green-100 text-green-700",
  wordpress: "bg-blue-100 text-blue-700",
  blogger: "bg-amber-100 text-amber-700",
};

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "high") return <Badge className="bg-red-100 text-red-700 border-red-200">높음</Badge>;
  if (priority === "medium") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">중간</Badge>;
  return <Badge variant="outline">낮음</Badge>;
}

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ blog?: string }>;
}) {
  const params = await searchParams;
  const selectedBlog = params.blog || "kyeyangdak";
  const [pool, allStats, blogList] = await Promise.all([
    getKeywordPool(selectedBlog),
    getAllKeywordStats(),
    getBlogList(),
  ]);

  // 발행된 키워드의 URL 조회 (publish_jobs에서)
  const supabase = await createClient();
  const publishedKeywordNames = pool?.keywords
    .filter((k) => k.status === "published")
    .map((k) => k.keyword) || [];

  let publishedUrls: Record<string, string> = {};
  if (publishedKeywordNames.length > 0) {
    const { data: jobs } = await supabase
      .from("publish_jobs")
      .select("keyword, published_url")
      .eq("blog_id", selectedBlog)
      .eq("status", "published")
      .not("published_url", "is", null);
    if (jobs) {
      publishedUrls = Object.fromEntries(
        jobs.map((j) => [j.keyword, j.published_url])
      );
    }
  }

  const BLOGS = Object.keys(blogList).length > 0
    ? Object.keys(blogList)
    : Object.keys(allStats);

  const pendingKeywords = pool?.keywords
    .filter((k) => k.status !== "published")
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (pDiff !== 0) return pDiff;
      const aClicks = a.prediction?.expected_clicks_4w || 0;
      const bClicks = b.prediction?.expected_clicks_4w || 0;
      return bClicks - aClicks;
    }) || [];

  const publishedKeywords = pool?.keywords.filter((k) => k.status === "published") || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="keywords" />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">키워드 관리</h2>
          <div className="text-sm text-gray-500">
            {selectedBlog && allStats[selectedBlog] && (
              <span>대기 {allStats[selectedBlog].pending}건 / 전체 {allStats[selectedBlog].total}건</span>
            )}
          </div>
        </div>

        {/* Blog Selector */}
        <div className="flex flex-wrap gap-2">
          {BLOGS.map((blog) => {
            const stat = allStats[blog];
            const info = blogList[blog];
            const platform = info?.platform || "";
            const isSelected = blog === selectedBlog;
            return (
              <a
                key={blog}
                href={`/keywords?blog=${blog}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  isSelected
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-emerald-300"
                }`}
              >
                {platform && !isSelected && (
                  <span className={`text-[10px] px-1 rounded ${PLATFORM_COLORS[platform] || "bg-gray-100 text-gray-600"}`}>
                    {PLATFORM_LABELS[platform] || platform}
                  </span>
                )}
                {info?.label || blog}
                {stat && <span className="opacity-70">({stat.pending})</span>}
              </a>
            );
          })}
        </div>

        {/* Pending Keywords */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>대기 키워드 ({pendingKeywords.length}건)</span>
              <span className="text-sm font-normal text-gray-500">예상 클릭 높은 순</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>키워드</TableHead>
                  <TableHead>카테고리</TableHead>
                  <TableHead>우선순위</TableHead>
                  <TableHead className="text-right">예상 클릭</TableHead>
                  <TableHead className="text-right">검색량</TableHead>
                  <TableHead className="text-right">난이도</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingKeywords.slice(0, 30).map((kw, i) => {
                  const pred = kw.prediction;
                  const cat = kw.category || "-";
                  return (
                    <TableRow key={kw.keyword}>
                      <TableCell className="text-gray-400 tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{kw.keyword}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{cat}</TableCell>
                      <TableCell><PriorityBadge priority={kw.priority} /></TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pred?.expected_clicks_4w ? (
                          <span className="text-emerald-600 font-medium">{pred.expected_clicks_4w}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-500">
                        {pred?.monthly_search || "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pred?.difficulty ? (
                          <span className={pred.difficulty >= 7 ? "text-red-500" : pred.difficulty >= 5 ? "text-amber-500" : "text-green-500"}>
                            {pred.difficulty}/10
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {pendingKeywords.length > 30 && (
              <p className="text-sm text-gray-400 mt-4 text-center">... 외 {pendingKeywords.length - 30}건</p>
            )}
          </CardContent>
        </Card>

        {/* Published Keywords */}
        <Card>
          <CardHeader>
            <CardTitle>발행 완료 ({publishedKeywords.length}건)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>키워드</TableHead>
                  <TableHead>카테고리</TableHead>
                  <TableHead>발행일</TableHead>
                  <TableHead>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {publishedKeywords.slice(0, 20).map((kw) => {
                  const cat = kw.category || "-";
                  const url = publishedUrls[kw.keyword];
                  return (
                    <TableRow key={kw.keyword}>
                      <TableCell className="font-medium">{kw.keyword}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{cat}</TableCell>
                      <TableCell className="text-gray-500 tabular-nums text-sm">
                        {kw.published_at?.slice(0, 10) || "-"}
                      </TableCell>
                      <TableCell>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                             className="text-xs text-emerald-600 hover:text-emerald-700 truncate block max-w-[200px]">
                            {url.replace(/https?:\/\//, "").slice(0, 40)}...
                          </a>
                        ) : (
                          <span className="text-gray-300 text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {publishedKeywords.length > 20 && (
              <p className="text-sm text-gray-400 mt-4 text-center">... 외 {publishedKeywords.length - 20}건</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
