import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { sendTelegramNotification, formatPublishNotification } from '@/lib/telegram'

export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Cron은 서비스 역할 키로 실행 (사용자 세션 없음)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(request: Request) {
  // Vercel Cron 인증
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 모든 사용자의 블로그에서 자동 발행 대상 찾기
  const { data: blogs } = await supabase
    .from('blogs')
    .select('*, keywords!inner(id, keyword, category, priority)')
    .eq('adapter', 'keyword')

  if (!blogs?.length) {
    return NextResponse.json({ message: 'No blogs to publish', published: 0 })
  }

  let publishedCount = 0

  for (const blog of blogs) {
    // 이 블로그의 대기 키워드 중 우선순위 높은 것
    const { data: nextKeyword } = await supabase
      .from('keywords')
      .select('*')
      .eq('blog_id', blog.id)
      .eq('user_id', blog.user_id)
      .eq('status', 'pending')
      .order('priority')
      .limit(1)
      .single()

    if (!nextKeyword) continue

    // 키워드를 즉시 'generating' 상태로 변경 (다음 Cron에서 재선택 방지)
    await supabase
      .from('keywords')
      .update({ status: 'generating' })
      .eq('id', nextKeyword.id)

    // 오늘 이미 이 블로그에서 발행했는지 확인
    const today = new Date().toISOString().slice(0, 10)
    const { count } = await supabase
      .from('publish_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('blog_id', blog.id)
      .eq('user_id', blog.user_id)
      .gte('created_at', `${today}T00:00:00`)

    if (count && count > 0) continue // 하루 1개 제한

    // 발행 작업 생성
    const { data: job } = await supabase
      .from('publish_jobs')
      .insert({
        user_id: blog.user_id,
        blog_id: blog.id,
        keyword_id: nextKeyword.id,
        keyword: nextKeyword.keyword,
        status: 'generating',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (!job) continue

    try {
      const persona = blog.persona || '블로거'
      const style = blog.style || 'professional'
      const endingForm = blog.ending_form || '~합니다'
      const targetAudience = blog.target_audience || '일반 독자'

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `당신은 "${persona}"입니다. ${blog.description || ''}
타겟 독자: ${targetAudience}. 글 스타일: ${style}. 말투: ${endingForm}.
HTML 형식으로 블로그 글 본문을 작성하세요. h2/h3로 구조화, 최소 2000자, 키워드 3-5회 포함.`
          },
          {
            role: 'user',
            content: `키워드: ${nextKeyword.keyword}\n\n다음 JSON 형식으로 응답해주세요:\n{\n  "title": "SEO에 최적화된 블로그 제목",\n  "html": "HTML 본문 (h2/h3 구조화, <p>, <ul> 등 사용. <!DOCTYPE> 등 제외)",\n  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],\n  "meta_description": "검색 결과에 표시될 150자 이내 요약"\n}`
          },
        ],
        max_tokens: 4000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      let parsed: { title?: string; html?: string; tags?: string[]; meta_description?: string }
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = { html: raw, title: nextKeyword.keyword, tags: [], meta_description: '' }
      }

      const title = parsed.title || nextKeyword.keyword
      const contentHtml = parsed.html || raw
      const tags = parsed.tags || []
      const metaDescription = parsed.meta_description || ''

      const telegramSent = await sendTelegramNotification(
        formatPublishNotification(blog.label, title, nextKeyword.keyword)
      )

      await supabase
        .from('publish_jobs')
        .update({
          status: 'publish_requested',
          title,
          content_html: contentHtml,
          completed_at: new Date().toISOString(),
          telegram_sent: telegramSent,
          metadata: { title, tags, meta_description: metaDescription, model: 'gpt-4o-mini', tokens: completion.usage?.total_tokens, source: 'cron' },
        })
        .eq('id', job.id)

      publishedCount++
    } catch (err) {
      await supabase
        .from('publish_jobs')
        .update({
          status: 'failed',
          error_message: err instanceof Error ? err.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
    }
  }

  return NextResponse.json({
    message: `Cron complete: ${publishedCount} posts generated`,
    published: publishedCount,
  })
}
