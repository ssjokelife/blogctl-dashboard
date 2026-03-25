'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function addBlog(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const blogId = (formData.get('blogId') as string)?.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const label = (formData.get('label') as string)?.trim()
  const url = (formData.get('url') as string)?.trim()
  const platform = (formData.get('platform') as string) || 'tistory'
  const purpose = (formData.get('purpose') as string) || 'adsense'

  if (!blogId || !label) return

  await supabase.from('blogs').upsert({
    id: blogId,
    user_id: user.id,
    label,
    url,
    platform,
    purpose,
    url_pattern: url ? new URL(url).hostname : '',
  }, { onConflict: 'id,user_id' })

  redirect('/')
}

export async function skipOnboarding() {
  redirect('/')
}
