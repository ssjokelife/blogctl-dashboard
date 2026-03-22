import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { blogId, keywordId, keyword, dryRun } = body

  if (!blogId || !keyword) {
    return NextResponse.json({ error: 'blogId and keyword are required' }, { status: 400 })
  }

  // 블로그 존재 확인
  const { data: blog } = await supabase
    .from('blogs')
    .select('id, label')
    .eq('id', blogId)
    .eq('user_id', user.id)
    .single()

  if (!blog) return NextResponse.json({ error: 'Blog not found' }, { status: 404 })

  if (dryRun) {
    return NextResponse.json({ error: 'dry-run은 워커에서만 지원됩니다. 워커가 실행 중인지 확인하세요.' }, { status: 400 })
  }

  // 작업 생성 — GPT 호출 없이 워커에게 위임
  const { data: job, error: jobError } = await supabase
    .from('publish_jobs')
    .insert({
      user_id: user.id,
      blog_id: blogId,
      keyword_id: keywordId || null,
      keyword,
      status: 'generate_requested',
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  return NextResponse.json({
    jobId: job.id,
    message: '콘텐츠 생성 요청됨 — 워커에서 처리 중',
    status: 'generate_requested',
  })
}
