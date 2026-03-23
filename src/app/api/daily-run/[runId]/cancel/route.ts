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
    .not('status', 'in', '(completed,failed,cancelled)')
    .single()

  if (!run) return NextResponse.json({ error: 'Not found or already finished' }, { status: 404 })

  await supabase
    .from('daily_runs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', runId)

  return NextResponse.json({ message: '취소됨' })
}
