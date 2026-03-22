'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function PublishButtonPlatform({ jobId }: { jobId: number }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handlePublish() {
    setState('loading')
    try {
      const res = await fetch(`/api/jobs/${jobId}/publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setState('error')
        setMessage(data.error || '요청 실패')
        return
      }
      setState('done')
      setMessage('발행 요청됨')
    } catch {
      setState('error')
      setMessage('네트워크 오류')
    }
  }

  return (
    <Button
      onClick={handlePublish}
      disabled={state === 'loading' || state === 'done'}
      variant={state === 'error' ? 'destructive' : state === 'done' ? 'outline' : 'default'}
      className={state === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
    >
      {state === 'idle' && '블로그에 발행'}
      {state === 'loading' && '요청 중...'}
      {state === 'done' && message}
      {state === 'error' && message}
    </Button>
  )
}
