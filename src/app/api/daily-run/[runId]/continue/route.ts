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
    .in('status', ['plan_ready', 'publishing'])
    .single()

  if (!run) return NextResponse.json({ error: 'Not found or invalid status' }, { status: 404 })

  const { data: updated } = await supabase
    .from('publish_jobs')
    .update({ status: 'publish_requested' })
    .eq('daily_run_id', runId)
    .eq('status', 'completed')
    .select('id')

  return NextResponse.json({ message: '발행 진행 중', count: updated?.length || 0 })
}
