'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function IndexButton({ jobId, initialStatus }: { jobId: number; initialStatus?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    initialStatus === 'requested' ? 'done' : 'idle'
  )
  const [message, setMessage] = useState(initialStatus === 'requested' ? '인덱싱 요청됨' : '')

  async function handleIndex() {
    setState('loading')
    try {
      const res = await fetch('/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState('error')
        setMessage(data.error || '요청 실패')
        return
      }
      setState('done')
      setMessage('인덱싱 요청됨')
    } catch {
      setState('error')
      setMessage('네트워크 오류')
    }
  }

  return (
    <Button
      onClick={handleIndex}
      disabled={state === 'loading' || state === 'done'}
      variant="outline"
      size="sm"
      className={state === 'done' ? 'text-emerald-600 border-emerald-200' : ''}
    >
      {state === 'idle' && 'GSC 인덱싱'}
      {state === 'loading' && '요청 중...'}
      {state === 'done' && message}
      {state === 'error' && message}
    </Button>
  )
}
