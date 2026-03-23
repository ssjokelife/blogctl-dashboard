'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DailyRun, DailyRunJob } from '@/lib/daily-run'

// --- Blog info type ---
type BlogInfo = { label: string; url: string; platform: string; adapter: string }
type BlogList = Record<string, BlogInfo>

const PLATFORM_LABELS: Record<string, string> = {
  tistory: 'T',
  naver: 'N',
  wordpress: 'WP',
  blogger: 'BG',
  hashnode: 'HN',
  devto: 'DV',
}

const PLATFORM_COLORS: Record<string, string> = {
  tistory: 'bg-orange-100 text-orange-700',
  naver: 'bg-green-100 text-green-700',
  wordpress: 'bg-blue-100 text-blue-700',
  blogger: 'bg-amber-100 text-amber-700',
  hashnode: 'bg-indigo-100 text-indigo-700',
  devto: 'bg-gray-100 text-gray-700',
}

// --- Status labels & colors ---

const STATUS_LABELS: Record<string, string> = {
  pending: '대기 중',
  analyzing: '분석 중',
  plan_ready: '계획 완료',
  publishing: '발행 중',
  reporting: '보고 생성 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
}

const JOB_STATUS_COLORS: Record<string, string> = {
  generate_requested: 'bg-amber-100 text-amber-700',
  generating: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  publishing: 'bg-purple-100 text-purple-700',
  published: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
}

const JOB_STATUS_LABELS: Record<string, string> = {
  generate_requested: '생성 요청',
  generating: '생성 중',
  completed: '생성 완료',
  publishing: '발행 중',
  published: '발행됨',
  failed: '실패',
}

// --- Markdown to HTML (simple, XSS-safe) ---

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-2">$1</h1>')
    // bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // unordered list
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // line breaks
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')

  // strip any residual script/iframe/on* handlers (defense in depth)
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  html = html.replace(/\son\w+="[^"]*"/gi, '')
  html = html.replace(/\son\w+='[^']*'/gi, '')

  return html
}

// --- Stepper ---

function Stepper({ status }: { status: string }) {
  const steps = [
    { label: '분석', statuses: ['analyzing'] },
    { label: '발행', statuses: ['plan_ready', 'publishing'] },
    { label: '보고', statuses: ['reporting', 'completed'] },
  ]

  const currentIdx = steps.findIndex(s => s.statuses.includes(status))

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, i) => {
        const isDone = currentIdx > i || status === 'completed'
        const isActive = currentIdx === i && status !== 'completed'

        return (
          <div key={step.label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isActive
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isDone ? '\u2713' : i + 1}
              </div>
              <span className={`text-xs ${isDone ? 'text-emerald-600' : isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 ${isDone ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- Analysis Section ---

function AnalysisSection({ analysis, blogList }: {
  analysis: Record<string, unknown> | null
  blogList: BlogList
}) {
  if (!analysis) return null

  const blogs = (analysis.blogs || {}) as Record<string, {
    traffic?: number | null
    revenue?: { recent_7d?: number; prev_7d?: number; coupang_clicks_recent?: number } | null
    keywords?: { pending?: number; total?: number; urgent?: number; high?: number }
    recent_posts?: number
    indexing?: number | null
  }>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">블로그 분석</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(blogs).map(([blogId, data]) => (
            <div key={blogId} className="border rounded-lg p-4 space-y-2">
              <div className="font-medium text-sm">{blogList[blogId]?.label || blogId}</div>
              <div className="text-xs text-gray-500 space-y-1">
                <div className="flex justify-between">
                  <span>트래픽</span>
                  <span>{data.traffic != null ? data.traffic.toLocaleString() + '뷰' : '데이터 수집 중'}</span>
                </div>
                <div className="flex justify-between">
                  <span>수익 (7일)</span>
                  <span>{data.revenue?.recent_7d != null ? `\u20A9${data.revenue.recent_7d.toLocaleString()}` : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span>키워드</span>
                  <span>{data.keywords?.pending ?? 0}/{data.keywords?.total ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>색인율</span>
                  <span>{data.indexing != null ? `${Math.round(data.indexing)}%` : '-'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Publish Section ---

function PublishSection({ plan, jobs, run, blogList, onContinue }: {
  plan: Record<string, unknown> | null
  jobs: DailyRunJob[]
  run: DailyRun
  blogList: BlogList
  onContinue: () => void
}) {
  const reasons = (plan?.reasons || []) as string[]
  const isManual = run.mode === 'manual'
  const canContinue = isManual && run.status === 'plan_ready'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">발행 계획</CardTitle>
        {canContinue && (
          <Button onClick={onContinue} className="bg-emerald-600 hover:bg-emerald-700">
            전체 발행 계속
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {reasons.length > 0 && (
          <div className="text-sm text-gray-600 space-y-1">
            {reasons.map((r, i) => (
              <p key={i}>&bull; {r}</p>
            ))}
          </div>
        )}

        {jobs.length > 0 && (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center gap-3 border rounded-lg px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{job.keyword}</div>
                  {job.title && <div className="text-xs text-gray-400 truncate">{job.title}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {blogList[job.blog_id]?.platform && (
                    <Badge className={`text-[10px] px-1 py-0 ${PLATFORM_COLORS[blogList[job.blog_id].platform] || 'bg-gray-100 text-gray-600'}`}>
                      {PLATFORM_LABELS[blogList[job.blog_id].platform] || blogList[job.blog_id].platform}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {blogList[job.blog_id]?.label || job.blog_id}
                  </Badge>
                </div>
                <Badge className={`text-xs shrink-0 ${JOB_STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700'}`}>
                  {JOB_STATUS_LABELS[job.status] || job.status}
                </Badge>
                {job.published_url && (
                  <a
                    href={job.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:text-emerald-700 shrink-0"
                  >
                    보기
                  </a>
                )}
                {job.status === 'completed' && (
                  <a
                    href={`/jobs/${job.id}`}
                    className="text-xs text-blue-600 hover:text-blue-700 shrink-0"
                  >
                    상세
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {jobs.length === 0 && (
          <p className="text-sm text-gray-400">아직 생성된 작업이 없습니다</p>
        )}
      </CardContent>
    </Card>
  )
}

// --- Report Section ---

function ReportSection({ report, todos, onToggleTodo }: {
  report: string | null
  todos: DailyRun['todos']
  onToggleTodo: (todoId: string) => void
}) {
  if (!report && (!todos || todos.length === 0)) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">실행 보고서</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {report && (
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(report) }}
          />
        )}

        {todos && todos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">TODO</h3>
            {todos.map((todo) => (
              <label key={todo.id} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => onToggleTodo(todo.id)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${todo.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                    {todo.title}
                  </div>
                  <div className="text-xs text-gray-400">{todo.reason}</div>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">
                  {todo.priority}
                </Badge>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --- Log Entry ---
interface LogEntry {
  id: number
  level: string
  message: string
  created_at: string
}

// --- Log Panel ---
function LogPanel({ logs }: { logs: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  if (logs.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">진행 로그</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-80 overflow-y-auto space-y-1 font-mono text-xs">
          {logs.map((log) => (
            <div
              key={log.id}
              className={`flex gap-2 py-0.5 ${
                log.level === 'error' ? 'text-red-600' :
                log.level === 'warning' ? 'text-amber-600' :
                'text-gray-600'
              }`}
            >
              <span className="text-gray-400 shrink-0">
                {new Date(log.created_at).toLocaleTimeString('ko-KR')}
              </span>
              <span>{log.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </CardContent>
    </Card>
  )
}

// --- Main Component ---

export function DailyRunDetail({ initialRun, initialJobs, initialLogs = [], blogList }: {
  initialRun: DailyRun
  initialJobs: DailyRunJob[]
  initialLogs?: LogEntry[]
  blogList: BlogList
}) {
  const [run, setRun] = useState<DailyRun>(initialRun)
  const [jobs, setJobs] = useState<DailyRunJob[]>(initialJobs)
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs)
  const [actionLoading, setActionLoading] = useState(false)

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient()

    const runChannel = supabase
      .channel(`daily-run-${initialRun.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_runs',
        filter: `id=eq.${initialRun.id}`,
      }, (payload) => {
        setRun(payload.new as DailyRun)
      })
      .subscribe()

    const jobChannel = supabase
      .channel(`daily-run-jobs-${initialRun.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'publish_jobs',
        filter: `daily_run_id=eq.${initialRun.id}`,
      }, (payload) => {
        const updated = payload.new as DailyRunJob
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === updated.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = updated
            return next
          }
          return [...prev, updated]
        })
      })
      .subscribe()

    const logChannel = supabase
      .channel(`daily-run-logs-${initialRun.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'daily_run_logs',
        filter: `daily_run_id=eq.${initialRun.id}`,
      }, (payload) => {
        setLogs(prev => [...prev, payload.new as LogEntry])
      })
      .subscribe()

    return () => {
      supabase.removeChannel(runChannel)
      supabase.removeChannel(jobChannel)
      supabase.removeChannel(logChannel)
    }
  }, [initialRun.id])

  // Actions
  const handleCancel = useCallback(async () => {
    setActionLoading(true)
    try {
      await fetch(`/api/daily-run/${run.id}/cancel`, { method: 'POST' })
    } finally {
      setActionLoading(false)
    }
  }, [run.id])

  const handleFinalize = useCallback(async () => {
    setActionLoading(true)
    try {
      await fetch(`/api/daily-run/${run.id}/finalize`, { method: 'POST' })
    } finally {
      setActionLoading(false)
    }
  }, [run.id])

  const handleContinue = useCallback(async () => {
    setActionLoading(true)
    try {
      await fetch(`/api/daily-run/${run.id}/continue`, { method: 'POST' })
    } finally {
      setActionLoading(false)
    }
  }, [run.id])

  const handleToggleTodo = useCallback(async (todoId: string) => {
    if (!run.todos) return
    const updated = run.todos.map(t =>
      t.id === todoId ? { ...t, done: !t.done } : t
    )
    setRun(prev => ({ ...prev, todos: updated }))

    const supabase = createClient()
    await supabase
      .from('daily_runs')
      .update({ todos: updated })
      .eq('id', run.id)
  }, [run.id, run.todos])

  const isTerminal = ['completed', 'failed', 'cancelled'].includes(run.status)
  const canCancel = !isTerminal
  const canFinalize = run.status === 'publishing' || run.status === 'plan_ready'

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <Stepper status={run.status} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">오늘의 실행</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={`text-xs ${
              run.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                : run.status === 'failed' ? 'bg-red-100 text-red-700'
                : run.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {STATUS_LABELS[run.status] || run.status}
            </Badge>
            <span className="text-xs text-gray-400">
              {run.mode === 'auto' ? '자동 발행' : '수동 리뷰'} &middot; {run.trigger_type === 'cron' ? '예약' : '수동'} 실행
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {canCancel && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={actionLoading}
            >
              취소
            </Button>
          )}
          {canFinalize && (
            <Button
              onClick={handleFinalize}
              disabled={actionLoading}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              완료 처리
            </Button>
          )}
        </div>
      </div>

      {/* Log Panel */}
      <LogPanel logs={logs} />

      {/* Error */}
      {run.error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <p className="text-sm text-red-700">{run.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Analysis */}
      <AnalysisSection analysis={run.analysis} blogList={blogList} />

      {/* Publish */}
      <PublishSection
        plan={run.plan}
        jobs={jobs}
        run={run}
        blogList={blogList}
        onContinue={handleContinue}
      />

      {/* Report */}
      <ReportSection
        report={run.report}
        todos={run.todos}
        onToggleTodo={handleToggleTodo}
      />
    </div>
  )
}
