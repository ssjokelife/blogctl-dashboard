import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { sendTelegramNotification, formatPublishNotification } from '@/lib/telegram'
import { fixHtml } from '@/lib/html-fixer'
import { validateContent, type QualityResult } from '@/lib/quality'

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

    const isCoupang = blog.adapter === 'coupang'
    const affiliateInstructions = isCoupang ? `

## 쿠팡 파트너스 콘텐츠 규칙
1. 제품 리뷰/비교 형식으로 작성
2. 제품의 장단점을 객관적으로 설명
3. "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다" 문구를 글 마지막에 포함
4. 구매 가이드, 체크리스트 형식 활용
5. 가격대별 추천 또는 용도별 추천 구조 사용` : ''

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
8. 코드가 필요하면 <pre><code> 태그 사용${affiliateInstructions}`

    const userPrompt = `다음 키워드로 블로그 글을 작성해주세요.

키워드: ${keyword}

다음 JSON 형식으로 응답해주세요:
{
  "title": "SEO에 최적화된 블로그 제목",
  "html": "HTML 본문 (h2/h3 구조화, <p>, <ul> 등 사용. <!DOCTYPE> 등 제외)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "meta_description": "검색 결과에 표시될 150자 이내 요약"
}`

    // 품질 검증 + 재시도 루프 (최대 2회 재생성)
    const maxRetries = 2
    let finalHtml = ''
    let finalTitle = ''
    let finalTags: string[] = []
    let finalMetaDescription = ''
    let totalTokens = 0
    let qualityResult: QualityResult | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: attempt === 0 ? userPrompt : userPrompt + `\n\n[개선 피드백]\n이전 콘텐츠의 품질이 부족했습니다. 다음 사항을 개선해주세요:\n${qualityResult?.suggestions.join('\n') || '전반적 품질 향상'}` },
      ]

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 4000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      totalTokens += completion.usage?.total_tokens || 0
      let parsed: { title?: string; html?: string; tags?: string[]; meta_description?: string }
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = { html: raw, title: keyword, tags: [], meta_description: '' }
      }

      finalTitle = parsed.title || keyword
      finalHtml = fixHtml(parsed.html || raw, { keyword, blogId })
      finalTags = parsed.tags || []
      finalMetaDescription = parsed.meta_description || ''

      // 품질 검증
      qualityResult = validateContent(finalHtml, keyword, blog.adapter)

      if (qualityResult.passed) {
        break // 품질 통과
      }

      if (attempt < maxRetries) {
        console.log(`Quality retry ${attempt + 1}: score ${qualityResult.totalScore}/100`)
      }
    }

    // Telegram 알림
    const telegramSent = await sendTelegramNotification(
      formatPublishNotification(blog.label, finalTitle, keyword)
    )

    // 작업 업데이트
    await supabase
      .from('publish_jobs')
      .update({
        status: 'completed',
        title: finalTitle,
        content_html: finalHtml,
        completed_at: new Date().toISOString(),
        telegram_sent: telegramSent,
        metadata: {
          title: finalTitle, tags: finalTags, meta_description: finalMetaDescription,
          model: 'gpt-4o-mini', tokens: totalTokens,
          quality_score: qualityResult?.totalScore,
          quality_passed: qualityResult?.passed,
        },
      })
      .eq('id', job.id)

    return NextResponse.json({
      jobId: job.id,
      title: finalTitle,
      tags: finalTags,
      contentLength: finalHtml.length,
      tokens: totalTokens,
      qualityScore: qualityResult?.totalScore,
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
