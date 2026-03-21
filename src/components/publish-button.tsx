'use client'

import { useState } from 'react'

export function PublishButton({ blogId, keywordId, keyword }: {
  blogId: string
  keywordId?: number
  keyword: string
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ title?: string; contentLength?: number; tokens?: number; error?: string } | null>(null)

  const handlePublish = async () => {
    setStatus('loading')
    setResult(null)

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId, keywordId, keyword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setResult({ error: data.error || 'Failed' })
        return
      }

      setStatus('done')
      setResult(data)
    } catch (err) {
      setStatus('error')
      setResult({ error: err instanceof Error ? err.message : 'Network error' })
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handlePublish}
        disabled={status === 'loading'}
        className={`text-xs px-2 py-1 rounded transition-colors ${
          status === 'loading'
            ? 'bg-gray-100 text-gray-400 cursor-wait'
            : status === 'done'
            ? 'bg-emerald-100 text-emerald-700'
            : status === 'error'
            ? 'bg-red-100 text-red-700'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }`}
      >
        {status === 'loading' ? '생성 중...' :
         status === 'done' ? `완료 (${result?.tokens}토큰)` :
         status === 'error' ? '실패' :
         '글 생성'}
      </button>
      {status === 'error' && result?.error && (
        <span className="text-xs text-red-500">{result.error}</span>
      )}
    </div>
  )
}
