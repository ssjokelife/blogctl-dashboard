import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 원자적 상태 전환: completed/publish_failed → publish_requested
  // completed: 최초 발행 요청, publish_failed: 재시도
  const { data: job, error } = await supabase
    .from('publish_jobs')
    .update({
      status: 'publish_requested',
      publish_attempts: 0,
      publish_error: null,
      publish_error_type: null,
    })
    .eq('id', Number(jobId))
    .eq('user_id', user.id)
    .in('status', ['completed', 'publish_failed'])
    .select()
    .single()

  if (error || !job) {
    return NextResponse.json(
      { error: '발행 요청할 수 없는 상태입니다.' },
      { status: 400 }
    )
  }

  return NextResponse.json({ message: '발행 요청됨', jobId: job.id })
}
