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
