import { createClient } from '@/lib/supabase/server'
import { getKeywordStrategy } from '@/lib/prompts'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { blogId } = await request.json()
  if (!blogId) return NextResponse.json({ error: 'blogId required' }, { status: 400 })

  const { data: blog } = await supabase
    .from('blogs')
    .select('*')
    .eq('id', blogId)
    .eq('user_id', user.id)
    .single()

  if (!blog) return NextResponse.json({ error: 'Blog not found' }, { status: 404 })

  const strategy = getKeywordStrategy(blog.purpose || 'adsense')

  // 기존 키워드 가져오기 (중복 방지)
  const { data: existingKw } = await supabase
    .from('keywords')
    .select('keyword')
    .eq('blog_id', blogId)
    .eq('user_id', user.id)

  const existingList = (existingKw || []).map(k => k.keyword).join(', ')

  // 기존 발행 글 제목 가져오기 (콘텐츠 갭 분석)
  const { data: publishedPosts } = await supabase
    .from('publish_logs')
    .select('title')
    .eq('blog_id', blogId)
    .eq('user_id', user.id)
    .order('published_at', { ascending: false })
    .limit(30)

  const publishedTitles = (publishedPosts || []).map(p => p.title).join('\n')

  const categories = (blog.categories || []).join(', ')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `당신은 블로그 키워드 리서치 전문가입니다. 블로그의 페르소나와 기존 콘텐츠를 분석해서 다음에 작성할 키워드를 추천합니다.

${strategy.systemAddendum}

JSON 배열로 응답해주세요. 각 항목: {"keyword": "...", "category": "...", "priority": "high|medium|low", "reason": "추천 이유"}`
      },
      {
        role: 'user',
        content: `블로그: ${blog.label}
페르소나: ${blog.persona || '없음'}
설명: ${blog.description || '없음'}
타겟 독자: ${blog.target_audience || '없음'}
카테고리: ${categories || '없음'}

기존 키워드 (중복 금지):
${existingList || '없음'}

최근 발행 글:
${publishedTitles || '없음'}

10개의 새 키워드를 추천해주세요. JSON 배열만 응답하세요.`
      }
    ],
    max_tokens: 2000,
    temperature: 0.8,
    response_format: { type: 'json_object' },
  })

  try {
    const content = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)
    const suggestions = parsed.keywords || parsed.suggestions || parsed
    return NextResponse.json({
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      tokens: completion.usage?.total_tokens,
    })
  } catch {
    return NextResponse.json({ suggestions: [], error: 'Failed to parse suggestions' })
  }
}
