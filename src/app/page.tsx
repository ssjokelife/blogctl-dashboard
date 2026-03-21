import { getDashboardData, getRecentPublished, BLOG_LABELS } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function Dashboard() {
  // 블로그가 없는 사용자 → 온보딩
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { count } = await supabase
      .from("blogs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (!count || count === 0) redirect("/onboarding");
  }

  const { publishStats, keywordStats } = await getDashboardData();
  const recentPublished = await getRecentPublished(15);
  const totalPending = Object.values(keywordStats).reduce((s, v) => s + v.pending, 0);
  const totalBlogs = Object.keys(keywordStats).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="dashboard" />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">총 발행</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{publishStats.totalPublished.toLocaleString()}</div>
              <p className="text-sm text-gray-400 mt-1">오늘 +{publishStats.todayPublished}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">키워드 대기</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{totalPending}</div>
              <p className="text-sm text-gray-400 mt-1">{totalBlogs}개 블로그</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">쿠팡 클릭</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">7<span className="text-lg text-gray-400">/일</span></div>
              <p className="text-sm text-emerald-600 mt-1">+133% vs 이전</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">수익</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-300">&#8361;0</div>
              <p className="text-sm text-gray-400 mt-1">쿠팡 + 애드센스</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="blogs" className="space-y-4">
          <TabsList>
            <TabsTrigger value="blogs">블로그별 현황</TabsTrigger>
            <TabsTrigger value="recent">최근 발행</TabsTrigger>
            <TabsTrigger value="keywords">키워드 현황</TabsTrigger>
          </TabsList>

          <TabsContent value="blogs">
            <Card>
              <CardHeader>
                <CardTitle>블로그별 발행 현황</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>블로그</TableHead>
                      <TableHead className="text-right">총 발행</TableHead>
                      <TableHead className="text-right">오늘</TableHead>
                      <TableHead className="text-right">키워드 대기</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(publishStats.blogCounts)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([blog, counts]) => {
                        const kwStat = keywordStats[blog];
                        const pending = kwStat?.pending || 0;
                        return (
                          <TableRow key={blog}>
                            <TableCell className="font-medium">{BLOG_LABELS[blog] || blog}</TableCell>
                            <TableCell className="text-right tabular-nums">{counts.total}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {counts.today > 0 ? (
                                <span className="text-emerald-600 font-medium">+{counts.today}</span>
                              ) : (
                                <span className="text-gray-300">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{pending || "-"}</TableCell>
                            <TableCell>
                              {pending <= 10 ? (
                                <Badge variant="destructive">보충 필요</Badge>
                              ) : pending <= 20 ? (
                                <Badge variant="secondary">주의</Badge>
                              ) : (
                                <Badge variant="outline">정상</Badge>
                              )}
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
            <Card>
              <CardHeader>
                <CardTitle>최근 발행 글</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>블로그</TableHead>
                      <TableHead>제목</TableHead>
                      <TableHead>발행일</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentPublished.map((entry) => (
                      <TableRow key={entry.slug}>
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
                            className="text-gray-700 hover:text-emerald-600 transition-colors"
                          >
                            {(entry.title || entry.slug).slice(0, 50)}
                            {(entry.title || "").length > 50 ? "..." : ""}
                          </a>
                        </TableCell>
                        <TableCell className="text-gray-500 tabular-nums text-sm">
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
            <Card>
              <CardHeader>
                <CardTitle>키워드풀 현황</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>블로그</TableHead>
                      <TableHead className="text-right">전체</TableHead>
                      <TableHead className="text-right">발행됨</TableHead>
                      <TableHead className="text-right">대기</TableHead>
                      <TableHead className="text-right">소진 예상</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(keywordStats)
                      .sort(([, a], [, b]) => a.pending - b.pending)
                      .map(([blog, stat]) => {
                        const dailyRate = blog === "jokelife" ? 3 : ["kyeyangdak", "lukulu", "moneysave", "healthnote", "saasreview", "rukkuru"].includes(blog) ? 2 : 1;
                        const daysLeft = Math.floor(stat.pending / dailyRate);
                        return (
                          <TableRow key={blog}>
                            <TableCell className="font-medium">{BLOG_LABELS[blog] || blog}</TableCell>
                            <TableCell className="text-right tabular-nums">{stat.total}</TableCell>
                            <TableCell className="text-right tabular-nums text-gray-400">{stat.published}</TableCell>
                            <TableCell className="text-right tabular-nums">{stat.pending}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className={daysLeft <= 10 ? "text-red-500 font-medium" : daysLeft <= 20 ? "text-amber-500" : "text-gray-500"}>
                                {daysLeft}일
                              </span>
                            </TableCell>
                            <TableCell>
                              {stat.pending <= 10 ? (
                                <Badge variant="destructive">보충 필요</Badge>
                              ) : stat.pending <= 20 ? (
                                <Badge variant="secondary">주의</Badge>
                              ) : (
                                <Badge variant="outline">정상</Badge>
                              )}
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
