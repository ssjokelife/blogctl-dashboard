import { getRecentPublished, BLOG_LABELS } from "@/lib/data";
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

const BLOG_COLORS: Record<string, string> = {
  kyeyangdak: "bg-blue-100 text-blue-700",
  jokelife: "bg-purple-100 text-purple-700",
  lukulu: "bg-green-100 text-green-700",
  lifezig: "bg-orange-100 text-orange-700",
  rukkuru: "bg-emerald-100 text-emerald-700",
  moneysave: "bg-amber-100 text-amber-700",
  healthnote: "bg-red-100 text-red-700",
  aitoolspick: "bg-indigo-100 text-indigo-700",
  seasiaguide: "bg-cyan-100 text-cyan-700",
  codefirst: "bg-slate-100 text-slate-700",
  saasreview: "bg-pink-100 text-pink-700",
  freelancehub: "bg-violet-100 text-violet-700",
};

export default async function PublishLogPage() {
  const entries = await getRecentPublished(100);

  // Group by date
  const grouped: Record<string, typeof entries> = {};
  for (const entry of entries) {
    const date = entry.published_at?.slice(0, 10) || "unknown";
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="publish-log" />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">발행 로그</h2>
          <p className="text-sm text-gray-500">최근 {entries.length}건</p>
        </div>

        {Object.entries(grouped).map(([date, dayEntries]) => (
          <Card key={date}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <span>{date}</span>
                <Badge variant="secondary">{dayEntries.length}건</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">블로그</TableHead>
                    <TableHead>제목</TableHead>
                    <TableHead className="w-20 text-right">시간</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayEntries.map((entry) => (
                    <TableRow key={entry.slug}>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${BLOG_COLORS[entry.blog] || "bg-gray-100 text-gray-700"}`}>
                          {BLOG_LABELS[entry.blog] || entry.blog}
                        </span>
                      </TableCell>
                      <TableCell>
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-700 hover:text-emerald-600 transition-colors"
                        >
                          {(entry.title || entry.slug).slice(0, 60)}
                          {(entry.title || "").length > 60 ? "..." : ""}
                        </a>
                      </TableCell>
                      <TableCell className="text-right text-gray-400 tabular-nums text-sm">
                        {entry.published_at?.split("T")[1]?.slice(0, 5) || ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
