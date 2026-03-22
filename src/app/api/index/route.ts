import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requestIndexing } from '@/lib/gsc'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await request.json()
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })

  // job 조회 — published 상태이고 published_url이 있어야 함
  const { data: job } = await supabase
    .from('publish_jobs')
    .select('id, published_url, index_status, user_id')
    .eq('id', Number(jobId))
    .eq('user_id', user.id)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (!job.published_url) {
    return NextResponse.json({ error: '발행 URL이 없습니다.' }, { status: 400 })
  }

  // GSC 인덱싱 요청
  const result = await requestIndexing(job.published_url)

  // 상태 업데이트
  await supabase
    .from('publish_jobs')
    .update({
      index_status: result.success ? 'requested' : 'failed',
      indexed_at: result.success ? new Date().toISOString() : null,
    })
    .eq('id', job.id)

  if (result.success) {
    return NextResponse.json({ message: '인덱싱 요청 완료', url: job.published_url })
  } else {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
}
