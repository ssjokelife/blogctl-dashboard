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

HTML 본문만 작성해주세요. <!DOCTYPE>, <html>, <head>, <body> 태그는 제외하고 콘텐츠 부분만 작성합니다.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    })

    const contentHtml = completion.choices[0]?.message?.content || ''

    // 제목 추출 (첫 번째 h2 또는 키워드 기반)
    const titleMatch = contentHtml.match(/<h2[^>]*>(.*?)<\/h2>/i)
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '') : keyword

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
        metadata: { title, model: 'gpt-4o', tokens: completion.usage?.total_tokens },
      })
      .eq('id', job.id)

    // 키워드 상태 업데이트
    if (keywordId) {
      await supabase
        .from('keywords')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', keywordId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({
      jobId: job.id,
      title,
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
