import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { blogId, keyword, category, priority } = await request.json()
  if (!blogId || !keyword) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { error } = await supabase.from('keywords').insert({
    user_id: user.id,
    blog_id: blogId,
    keyword,
    category: category || null,
    priority: priority || 'medium',
    status: 'pending',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
