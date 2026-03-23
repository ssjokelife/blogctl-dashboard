import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: run } = await supabase
    .from('daily_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', user.id)
    .single()

  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('id, blog_id, keyword, status, title, published_url, publish_error, created_at')
    .eq('daily_run_id', runId)
    .order('created_at')

  return NextResponse.json({ run, jobs: jobs || [] })
}
