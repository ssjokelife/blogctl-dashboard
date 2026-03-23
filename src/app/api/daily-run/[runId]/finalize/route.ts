import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: run } = await supabase
    .from('daily_runs')
    .select('id, status')
    .eq('id', runId)
    .eq('user_id', user.id)
    .eq('status', 'publishing')
    .single()

  if (!run) return NextResponse.json({ error: 'Not found or invalid status' }, { status: 404 })

  await supabase
    .from('daily_runs')
    .update({ status: 'finalize_requested' })
    .eq('id', runId)

  return NextResponse.json({ message: '보고 생성 요청됨' })
}
