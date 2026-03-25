import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AdsenseMetricsProps {
  data: Record<string, unknown> | null
}

export function AdsenseMetrics({ data }: AdsenseMetricsProps) {
  const adsense = (data as Record<string, Record<string, number>> | null)?.adsense
  if (!adsense) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">애드센스 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">측정 데이터가 없습니다. measurements에 adsense 데이터가 수집되면 여기에 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">애드센스 지표</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">수익</p>
            <p className="text-lg font-bold">₩{(adsense.revenue || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">페이지뷰</p>
            <p className="text-lg font-bold">{(adsense.pageviews || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">CTR</p>
            <p className="text-lg font-bold">{adsense.ctr || 0}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">RPM</p>
            <p className="text-lg font-bold">₩{(adsense.rpm || 0).toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
