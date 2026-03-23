'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type TriggerState = 'idle' | 'selecting' | 'loading'

export function DailyRunTrigger() {
  const [state, setState] = useState<TriggerState>('idle')
  const router = useRouter()

  async function handleStart(mode: 'auto' | 'manual') {
    setState('loading')
    try {
      const res = await fetch('/api/daily-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json()

      if (res.status === 409 && data.runId) {
        router.push(`/daily-run/${data.runId}`)
        return
      }

      if (!res.ok) {
        setState('idle')
        return
      }

      router.push(`/daily-run/${data.runId}`)
    } catch {
      setState('idle')
    }
  }

  if (state === 'loading') {
    return (
      <Button disabled className="w-full">
        시작 중...
      </Button>
    )
  }

  if (state === 'selecting') {
    return (
      <div className="flex gap-2">
        <Button
          onClick={() => handleStart('auto')}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700"
        >
          자동 발행
        </Button>
        <Button
          onClick={() => handleStart('manual')}
          variant="outline"
          className="flex-1"
        >
          수동 리뷰
        </Button>
        <Button
          onClick={() => setState('idle')}
          variant="ghost"
          className="px-3"
        >
          취소
        </Button>
      </div>
    )
  }

  return (
    <Button
      onClick={() => setState('selecting')}
      className="w-full bg-emerald-600 hover:bg-emerald-700"
    >
      실행하기
    </Button>
  )
}
