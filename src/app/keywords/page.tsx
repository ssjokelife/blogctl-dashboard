import { getAllKeywordStats, getKeywordPool } from "@/lib/data";
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

const BLOG_LABELS: Record<string, string> = {
  kyeyangdak: "계양닭 (기술)",
  jokelife: "조크라이프 (IT)",
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

const BLOGS = Object.keys(BLOG_LABELS);

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
  const pool = getKeywordPool(selectedBlog);
  const allStats = getAllKeywordStats();

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
      <header className="bg-white border-b px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold text-white">B</div>
            <h1 className="text-lg font-semibold text-gray-900">BlogCtl Dashboard</h1>
          </div>
          <nav className="flex gap-6 text-sm">
            <a href="/" className="text-gray-500 hover:text-gray-900">대시보드</a>
            <a href="/keywords" className="text-gray-900 font-medium">키워드</a>
            <a href="/publish-log" className="text-gray-500 hover:text-gray-900">발행 로그</a>
          </nav>
        </div>
      </header>

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
            const isSelected = blog === selectedBlog;
            return (
              <a
                key={blog}
                href={`/keywords?blog=${blog}`}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  isSelected
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-gray-700 border-gray-200 hover:border-emerald-300"
                }`}
              >
                {BLOG_LABELS[blog]}
                {stat && <span className="ml-1 opacity-70">({stat.pending})</span>}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {publishedKeywords.slice(0, 20).map((kw) => {
                  const cat = kw.category || "-";
                  return (
                    <TableRow key={kw.keyword}>
                      <TableCell className="font-medium">{kw.keyword}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{cat}</TableCell>
                      <TableCell className="text-gray-500 tabular-nums text-sm">
                        {kw.published_at?.slice(0, 10) || "-"}
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
