import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { sendTelegramNotification, formatPublishNotification } from '@/lib/telegram'

export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { blogId, keywordId, keyword } = body

  if (!blogId || !keyword) {
    return NextResponse.json({ error: 'blogId and keyword are required' }, { status: 400 })
  }

  // 블로그 정보 + 페르소나 가져오기
  const { data: blog } = await supabase
    .from('blogs')
    .select('*')
    .eq('id', blogId)
    .eq('user_id', user.id)
    .single()

  if (!blog) return NextResponse.json({ error: 'Blog not found' }, { status: 404 })

  // 발행 작업 생성
  const { data: job, error: jobError } = await supabase
    .from('publish_jobs')
    .insert({
      user_id: user.id,
      blog_id: blogId,
      keyword_id: keywordId || null,
      keyword,
      status: 'generating',
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  try {
    // 콘텐츠 생성
    const persona = blog.persona || '블로거'
    const style = blog.style || 'professional'
    const endingForm = blog.ending_form || '~합니다'
    const targetAudience = blog.target_audience || '일반 독자'
    const description = blog.description || ''
    const categories = (blog.categories || []).join(', ')

    const systemPrompt = `당신은 "${persona}"입니다.
${description}

## 블로그 설정
- 타겟 독자: ${targetAudience}
- 글 스타일: ${style}
- 말투: ${endingForm}
- 카테고리: ${categories}

## 작성 규칙
1. HTML 형식으로 작성 (전체 페이지가 아닌 본문 콘텐츠만)
2. h2, h3 태그로 구조화
3. 최소 2000자 이상 (한국어 기준)
4. 핵심 키워드를 자연스럽게 3-5회 포함
5. 독자에게 실용적인 정보 제공
6. 마지막에 정리/요약 섹션 포함
7. <p>, <ul>, <ol>, <strong>, <em> 태그 활용
8. 코드가 필요하면 <pre><code> 태그 사용`

    const userPrompt = `다음 키워드로 블로그 글을 작성해주세요.

키워드: ${keyword}

다음 JSON 형식으로 응답해주세요:
{
  "title": "SEO에 최적화된 블로그 제목",
  "html": "HTML 본문 (h2/h3 구조화, <p>, <ul> 등 사용. <!DOCTYPE> 등 제외)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "meta_description": "검색 결과에 표시될 150자 이내 요약"
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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
      // JSON 파싱 실패 시 raw를 HTML로 취급
      parsed = { html: raw, title: keyword, tags: [], meta_description: '' }
    }

    const title = parsed.title || keyword
    const contentHtml = parsed.html || raw
    const tags = parsed.tags || []
    const metaDescription = parsed.meta_description || ''

    // Telegram 알림
    const telegramSent = await sendTelegramNotification(
      formatPublishNotification(blog.label, title, keyword)
    )

    // 작업 업데이트
    await supabase
      .from('publish_jobs')
      .update({
        status: 'completed',
        title,
        content_html: contentHtml,
        completed_at: new Date().toISOString(),
        telegram_sent: telegramSent,
        metadata: {
          title, tags, meta_description: metaDescription,
          model: 'gpt-4o-mini', tokens: completion.usage?.total_tokens,
        },
      })
      .eq('id', job.id)

    return NextResponse.json({
      jobId: job.id,
      title,
      tags,
      contentLength: contentHtml.length,
      tokens: completion.usage?.total_tokens,
    })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await supabase
      .from('publish_jobs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
