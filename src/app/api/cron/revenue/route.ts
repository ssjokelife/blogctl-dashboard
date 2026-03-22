import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { fetchAdSenseData } from '@/lib/adsense'
import { fetchCoupangData } from '@/lib/coupang'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 어제 날짜 (Cron이 오전에 실행되므로 전날 데이터 수집)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const date = yesterday.toISOString().slice(0, 10)

  const [adsense, coupang] = await Promise.all([
    fetchAdSenseData(date),
    fetchCoupangData(date),
  ])

  const data: Record<string, unknown> = {}
  if (adsense) data.adsense = adsense
  if (coupang) data.coupang = coupang

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: 'No revenue data available', date })
  }

  // 모든 사용자에 대해 저장 (싱글테넌트이므로 첫 번째 사용자)
  const { data: users } = await supabase.from('profiles').select('id').limit(1)
  const userId = users?.[0]?.id

  if (!userId) {
    return NextResponse.json({ error: 'No user found' }, { status: 500 })
  }

  // upsert: 같은 날짜에 이미 데이터가 있으면 업데이트
  const { error } = await supabase
    .from('measurements')
    .upsert({
      user_id: userId,
      measured_at: date,
      data,
    }, { onConflict: 'user_id,measured_at' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    message: 'Revenue data collected',
    date,
    adsense: adsense ? { revenue: adsense.revenue, clicks: adsense.clicks } : null,
    coupang: coupang ? { revenue: coupang.revenue, clicks: coupang.clicks } : null,
  })
}
