'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function updatePersona(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const blogId = formData.get('blogId') as string
  const persona = (formData.get('persona') as string)?.trim() || null
  const description = (formData.get('description') as string)?.trim() || null
  const targetAudience = (formData.get('targetAudience') as string)?.trim() || null
  const style = formData.get('style') as string || 'professional'
  const endingForm = (formData.get('endingForm') as string)?.trim() || '~합니다'
  const categoriesRaw = (formData.get('categories') as string)?.trim() || ''
  const categories = categoriesRaw ? categoriesRaw.split(',').map(c => c.trim()).filter(Boolean) : []

  await supabase
    .from('blogs')
    .update({ persona, description, target_audience: targetAudience, style, ending_form: endingForm, categories })
    .eq('id', blogId)
    .eq('user_id', user.id)

  revalidatePath(`/blogs/${blogId}`)
}

export async function addKeyword(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const blogId = formData.get('blogId') as string
  const keyword = (formData.get('keyword') as string)?.trim()
  const category = (formData.get('category') as string)?.trim() || null
  const priority = formData.get('priority') as string || 'medium'

  if (!keyword) return

  await supabase.from('keywords').insert({
    user_id: user.id,
    blog_id: blogId,
    keyword,
    category,
    priority,
    status: 'pending',
  })

  revalidatePath(`/blogs/${blogId}`)
}

export async function updateKeywordStatus(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const keywordId = Number(formData.get('keywordId'))
  const status = formData.get('status') as string
  const blogId = formData.get('blogId') as string

  await supabase
    .from('keywords')
    .update({ status })
    .eq('id', keywordId)
    .eq('user_id', user.id)

  revalidatePath(`/blogs/${blogId}`)
}

export async function deleteKeyword(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const keywordId = Number(formData.get('keywordId'))
  const blogId = formData.get('blogId') as string

  await supabase
    .from('keywords')
    .delete()
    .eq('id', keywordId)
    .eq('user_id', user.id)

  revalidatePath(`/blogs/${blogId}`)
}
