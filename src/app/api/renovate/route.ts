import { createClient } from '@/lib/supabase/server'
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

  // 블로그 정보
  const { data: blog } = await supabase
    .from('blogs')
    .select('*')
    .eq('id', blogId)
    .eq('user_id', user.id)
    .single()

  if (!blog) return NextResponse.json({ error: 'Blog not found' }, { status: 404 })

  // 발행된 글 목록 (최근 50개)
  const { data: posts } = await supabase
    .from('publish_logs')
    .select('slug, title, url, published_at, category')
    .eq('blog_id', blogId)
    .eq('user_id', user.id)
    .order('published_at', { ascending: false })
    .limit(50)

  if (!posts?.length) {
    return NextResponse.json({ candidates: [], message: '발행된 글이 없습니다.' })
  }

  // 최근 측정 데이터
  const { data: measurement } = await supabase
    .from('measurements')
    .select('data')
    .eq('user_id', user.id)
    .order('measured_at', { ascending: false })
    .limit(1)
    .single()

  const postList = posts.map(p => `- ${p.title} (${p.published_at?.slice(0, 10)})`).join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `당신은 블로그 SEO 전문가입니다. 발행된 글 목록을 분석하고, 개선이 필요한 글을 선별하여 리노베이션 제안을 합니다.

분석 기준:
1. 오래된 글 중 트래픽 가능성이 높은 것 (키워드가 시의성 있는 경우)
2. 제목이 검색 의도와 맞지 않는 글
3. 유사한 주제 글을 통합할 수 있는 경우
4. 추가 정보로 업데이트하면 가치가 올라갈 글

JSON으로 응답: {"candidates": [{"title": "기존 제목", "action": "update|merge|rewrite", "suggestion": "구체적 개선 제안", "priority": "high|medium|low", "reason": "이유"}]}`
      },
      {
        role: 'user',
        content: `블로그: ${blog.label} (${blog.persona || ''})
카테고리: ${(blog.categories || []).join(', ')}
${measurement?.data ? `최근 측정 데이터: ${JSON.stringify(measurement.data).slice(0, 500)}` : ''}

발행된 글 목록:
${postList}

가장 개선 효과가 클 5개 글을 선별하고 구체적 리노베이션 제안을 해주세요. JSON만 응답하세요.`
      }
    ],
    max_tokens: 2000,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  })

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}')
    return NextResponse.json({
      candidates: parsed.candidates || [],
      tokens: completion.usage?.total_tokens,
    })
  } catch {
    return NextResponse.json({ candidates: [], error: 'Parse failed' })
  }
}
