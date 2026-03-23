import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mode = 'auto' } = await request.json()

  if (!['auto', 'manual'].includes(mode)) {
    return NextResponse.json({ error: 'mode는 auto 또는 manual' }, { status: 400 })
  }

  // KST 기준 오늘 중복 확인
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split('T')[0]

  const { data: existing } = await supabase
    .from('daily_runs')
    .select('id, status')
    .eq('user_id', user.id)
    .gte('created_at', `${today}T00:00:00+09:00`)
    .not('status', 'in', '(completed,failed,cancelled)')
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({
      error: '이미 진행 중인 실행이 있습니다',
      runId: existing[0].id,
    }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('daily_runs')
    .insert({
      user_id: user.id,
      status: 'pending',
      mode,
      trigger_type: 'manual',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ runId: data.id, message: '실행 시작됨' })
}
