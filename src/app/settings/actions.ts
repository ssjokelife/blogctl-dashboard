'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
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

  let urlPattern = ''
  if (url) {
    try { urlPattern = new URL(url).hostname } catch { urlPattern = url }
  }

  await supabase.from('blogs').upsert({
    id: blogId,
    user_id: user.id,
    label,
    url,
    platform,
    url_pattern: urlPattern,
    purpose,
  }, { onConflict: 'id,user_id' })

  revalidatePath('/settings')
}

export async function deleteBlog(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const blogId = formData.get('blogId') as string
  if (!blogId) return

  await supabase.from('blogs').delete().eq('id', blogId).eq('user_id', user.id)
  revalidatePath('/settings')
}
