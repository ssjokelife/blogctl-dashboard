import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { sendTelegramNotification, formatPublishNotification } from '@/lib/telegram'
import { fixHtml } from '@/lib/html-fixer'
import { validateContent, type QualityResult } from '@/lib/quality'

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
    .in('adapter', ['keyword', 'coupang'])

  if (!blogs?.length) {
    return NextResponse.json({ message: 'No blogs to publish', published: 0 })
  }

  let publishedCount = 0

  for (const blog of blogs) {
    // 이 블로그의 대기 키워드 조회
    const { data: pendingKeywords } = await supabase
      .from('keywords')
      .select('*')
      .eq('blog_id', blog.id)
      .eq('user_id', blog.user_id)
      .in('status', ['pending'])
      .limit(50)

    if (!pendingKeywords?.length) continue

    // 우선순위 정렬: urgent > high > medium > low
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    const sorted = pendingKeywords.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2
      const pb = priorityOrder[b.priority] ?? 2
      if (pa !== pb) return pa - pb
      // 같은 우선순위면 expected_clicks_4w 높은 것 우선
      return (b.expected_clicks_4w || 0) - (a.expected_clicks_4w || 0)
    })
    const nextKeyword = sorted[0]

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

      const isCoupang = blog.adapter === 'coupang'
      const affiliateInstructions = isCoupang ? `
쿠팡 파트너스 콘텐츠 규칙: 제품 리뷰/비교 형식으로 작성. 장단점을 객관적으로 설명. "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다" 문구를 글 마지막에 포함. 구매 가이드, 가격대별/용도별 추천 구조 사용.` : ''

      const systemPrompt = `당신은 "${persona}"입니다. ${blog.description || ''}
타겟 독자: ${targetAudience}. 글 스타일: ${style}. 말투: ${endingForm}.
HTML 형식으로 블로그 글 본문을 작성하세요. h2/h3로 구조화, 최소 2000자, 키워드 3-5회 포함.${affiliateInstructions}`

      const userPrompt = `키워드: ${nextKeyword.keyword}\n\n다음 JSON 형식으로 응답해주세요:\n{\n  "title": "SEO에 최적화된 블로그 제목",\n  "html": "HTML 본문 (h2/h3 구조화, <p>, <ul> 등 사용. <!DOCTYPE> 등 제외)",\n  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],\n  "meta_description": "검색 결과에 표시될 150자 이내 요약"\n}`

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
          parsed = { html: raw, title: nextKeyword.keyword, tags: [], meta_description: '' }
        }

        finalTitle = parsed.title || nextKeyword.keyword
        finalHtml = fixHtml(parsed.html || raw, { keyword: nextKeyword.keyword, blogId: blog.id })
        finalTags = parsed.tags || []
        finalMetaDescription = parsed.meta_description || ''

        // 품질 검증
        qualityResult = validateContent(finalHtml, nextKeyword.keyword, blog.adapter)

        if (qualityResult.passed) {
          break // 품질 통과
        }

        if (attempt < maxRetries) {
          console.log(`[cron] Quality retry ${attempt + 1}: score ${qualityResult.totalScore}/100`)
        }
      }

      const telegramSent = await sendTelegramNotification(
        formatPublishNotification(blog.label, finalTitle, nextKeyword.keyword)
      )

      await supabase
        .from('publish_jobs')
        .update({
          status: 'publish_requested',
          title: finalTitle,
          content_html: finalHtml,
          completed_at: new Date().toISOString(),
          telegram_sent: telegramSent,
          metadata: {
            title: finalTitle, tags: finalTags, meta_description: finalMetaDescription,
            model: 'gpt-4o-mini', tokens: totalTokens, source: 'cron',
            quality_score: qualityResult?.totalScore,
            quality_passed: qualityResult?.passed,
          },
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
