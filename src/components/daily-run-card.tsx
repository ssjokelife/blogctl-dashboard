'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DailyRunTrigger } from '@/components/daily-run-trigger'
import type { DailyRun } from '@/lib/daily-run'

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  analyzing: 'bg-blue-100 text-blue-700',
  plan_ready: 'bg-emerald-100 text-emerald-700',
  publishing: 'bg-purple-100 text-purple-700',
  reporting: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']

export function DailyRunCard({ initialRun }: { initialRun: DailyRun | null }) {
  const [run, setRun] = useState<DailyRun | null>(initialRun)

  useEffect(() => {
    if (!initialRun?.id) return

    const supabase = createClient()
    const channel = supabase
      .channel(`daily-run-card-${initialRun.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_runs',
        filter: `id=eq.${initialRun.id}`,
      }, (payload) => {
        setRun(payload.new as DailyRun)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [initialRun?.id])

  const isTerminal = run ? TERMINAL_STATUSES.includes(run.status) : false
  const todoCount = run?.todos?.filter(t => !t.done).length || 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">오늘의 실행</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!run && (
          <>
            <p className="text-sm text-gray-400">아직 오늘의 실행이 없습니다</p>
            <DailyRunTrigger />
          </>
        )}

        {run && (
          <>
            <div className="flex items-center justify-between">
              <Badge className={STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-700'}>
                {STATUS_LABELS[run.status] || run.status}
              </Badge>
              <span className="text-xs text-gray-400">
                {run.mode === 'auto' ? '자동' : '수동'}
              </span>
            </div>

            {!isTerminal && (
              <a
                href={`/daily-run/${run.id}`}
                className="block text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                진행 상황 보기 &rarr;
              </a>
            )}

            {run.status === 'completed' && (
              <a
                href={`/daily-run/${run.id}`}
                className="block text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                {todoCount > 0 ? `TODO ${todoCount}건 · ` : ''}상세 보기 &rarr;
              </a>
            )}

            {isTerminal && <DailyRunTrigger />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
