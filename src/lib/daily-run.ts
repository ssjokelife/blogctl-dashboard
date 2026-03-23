import { createClient } from '@/lib/supabase/server'

export interface DailyRun {
  id: string
  user_id: string
  status: string
  mode: string
  trigger_type: string
  analysis: Record<string, unknown> | null
  plan: Record<string, unknown> | null
  report: string | null
  todos: Array<{
    id: string
    type: string
    priority: string
    blog_id: string
    title: string
    reason: string
    done: boolean
  }> | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface DailyRunJob {
  id: number
  blog_id: string
  keyword: string
  status: string
  title: string | null
  published_url: string | null
  publish_error: string | null
  created_at: string
}

export async function getTodayRun(): Promise<DailyRun | null> {
  const supabase = await createClient()
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split('T')[0]

  const { data } = await supabase
    .from('daily_runs')
    .select('*')
    .gte('created_at', `${today}T00:00:00+09:00`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}

export async function getDailyRun(runId: string): Promise<{
  run: DailyRun
  jobs: DailyRunJob[]
} | null> {
  const supabase = await createClient()

  const { data: run } = await supabase
    .from('daily_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (!run) return null

  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('id, blog_id, keyword, status, title, published_url, publish_error, created_at')
    .eq('daily_run_id', runId)
    .order('created_at')

  return { run, jobs: jobs || [] }
}
