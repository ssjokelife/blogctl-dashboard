import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CoupangMetricsProps {
  data: Record<string, unknown> | null
}

export function CoupangMetrics({ data }: CoupangMetricsProps) {
  const coupang = (data as Record<string, Record<string, number>> | null)?.coupang
  if (!coupang) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">쿠팡 파트너스 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">측정 데이터가 없습니다. measurements에 coupang 데이터가 수집되면 여기에 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">쿠팡 파트너스 지표</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500">수익</p>
            <p className="text-lg font-bold">₩{(coupang.revenue || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">클릭수</p>
            <p className="text-lg font-bold">{(coupang.clicks || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">전환율</p>
            <p className="text-lg font-bold">{coupang.conversion_rate || 0}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
