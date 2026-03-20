import { getDashboardData, getRecentPublished } from "@/lib/data";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  unknown: "기타",
};

function StatusBadge({ pending }: { pending: number }) {
  if (pending <= 10) return <Badge variant="destructive">보충 필요</Badge>;
  if (pending <= 20) return <Badge variant="secondary">주의</Badge>;
  return <Badge variant="outline">정상</Badge>;
}

export default function Dashboard() {
  const { publishStats, keywordStats } = getDashboardData();
  const recentPublished = getRecentPublished(15);

  const totalPending = Object.values(keywordStats).reduce((s, v) => s + v.pending, 0);
  const totalBlogs = Object.keys(keywordStats).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold">B</div>
            <h1 className="text-lg font-semibold">BlogCtl Dashboard</h1>
          </div>
          <nav className="flex gap-6 text-sm text-zinc-400">
            <a href="/" className="text-zinc-100">대시보드</a>
            <a href="/keywords" className="hover:text-zinc-100 transition-colors">키워드</a>
            <a href="/publish-log" className="hover:text-zinc-100 transition-colors">발행 로그</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">총 발행</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{publishStats.totalPublished.toLocaleString()}</div>
              <p className="text-sm text-zinc-500 mt-1">오늘 +{publishStats.todayPublished}</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">키워드 대기</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalPending}</div>
              <p className="text-sm text-zinc-500 mt-1">{totalBlogs}개 블로그</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">쿠팡 클릭</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">7<span className="text-lg text-zinc-500">/일</span></div>
              <p className="text-sm text-emerald-500 mt-1">+133% vs 이전</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">수익</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-zinc-500">&#8361;0</div>
              <p className="text-sm text-zinc-500 mt-1">쿠팡 + 애드센스</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="blogs" className="space-y-4">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="blogs">블로그별 현황</TabsTrigger>
            <TabsTrigger value="recent">최근 발행</TabsTrigger>
            <TabsTrigger value="keywords">키워드 현황</TabsTrigger>
          </TabsList>

          <TabsContent value="blogs">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-base">블로그별 발행 현황</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">블로그</TableHead>
                      <TableHead className="text-zinc-400 text-right">총 발행</TableHead>
                      <TableHead className="text-zinc-400 text-right">오늘</TableHead>
                      <TableHead className="text-zinc-400 text-right">키워드 대기</TableHead>
                      <TableHead className="text-zinc-400">상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(publishStats.blogCounts)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([blog, counts]) => {
                        const kwStat = keywordStats[blog];
                        return (
                          <TableRow key={blog} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="font-medium">{BLOG_LABELS[blog] || blog}</TableCell>
                            <TableCell className="text-right font-mono">{counts.total}</TableCell>
                            <TableCell className="text-right font-mono">
                              {counts.today > 0 ? (
                                <span className="text-emerald-400">+{counts.today}</span>
                              ) : (
                                <span className="text-zinc-600">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">{kwStat?.pending || "-"}</TableCell>
                            <TableCell>
                              {kwStat && <StatusBadge pending={kwStat.pending} />}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recent">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-base">최근 발행 글</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">블로그</TableHead>
                      <TableHead className="text-zinc-400">제목</TableHead>
                      <TableHead className="text-zinc-400">발행일</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentPublished.map((entry) => (
                      <TableRow key={entry.slug} className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {BLOG_LABELS[entry.blog] || entry.blog}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-200 hover:text-emerald-400 transition-colors"
                          >
                            {(entry.title || entry.slug).slice(0, 50)}
                            {(entry.title || "").length > 50 ? "..." : ""}
                          </a>
                        </TableCell>
                        <TableCell className="text-zinc-500 font-mono text-sm">
                          {entry.published_at?.replace("T", " ").slice(0, 16)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="keywords">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-base">키워드풀 현황</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">블로그</TableHead>
                      <TableHead className="text-zinc-400 text-right">전체</TableHead>
                      <TableHead className="text-zinc-400 text-right">발행됨</TableHead>
                      <TableHead className="text-zinc-400 text-right">대기</TableHead>
                      <TableHead className="text-zinc-400 text-right">소진 예상</TableHead>
                      <TableHead className="text-zinc-400">상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(keywordStats)
                      .sort(([, a], [, b]) => a.pending - b.pending)
                      .map(([blog, stat]) => {
                        const dailyRate = blog === "jokelife" ? 3 : ["kyeyangdak", "lukulu", "moneysave", "healthnote", "saasreview", "rukkuru"].includes(blog) ? 2 : 1;
                        const daysLeft = Math.floor(stat.pending / dailyRate);
                        return (
                          <TableRow key={blog} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="font-medium">{BLOG_LABELS[blog] || blog}</TableCell>
                            <TableCell className="text-right font-mono">{stat.total}</TableCell>
                            <TableCell className="text-right font-mono text-zinc-500">{stat.published}</TableCell>
                            <TableCell className="text-right font-mono">{stat.pending}</TableCell>
                            <TableCell className="text-right font-mono">
                              <span className={daysLeft <= 10 ? "text-red-400" : daysLeft <= 20 ? "text-yellow-400" : "text-zinc-400"}>
                                {daysLeft}일
                              </span>
                            </TableCell>
                            <TableCell>
                              <StatusBadge pending={stat.pending} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
