'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function PreviewButton({ blogId, keyword, keywordId }: { blogId: string; keyword: string; keywordId?: number }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [preview, setPreview] = useState<{ title: string; html: string; qualityScore: number; tags: string[] } | null>(null)

  async function handlePreview() {
    setState('loading')
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId, keyword, keywordId, dryRun: true }),
      })
      const data = await res.json()
      if (res.ok) {
        setPreview(data)
        setState('done')
      } else {
        setState('idle')
      }
    } catch {
      setState('idle')
    }
  }

  if (state === 'done' && preview) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">미리보기</span>
            <span className={`text-xs px-2 py-0.5 rounded ${preview.qualityScore >= 75 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              품질 {preview.qualityScore}/100
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setState('idle'); setPreview(null) }}>닫기</Button>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="font-bold text-lg mb-2">{preview.title}</h3>
          <div className="flex gap-1 mb-3">
            {preview.tags.map(t => <span key={t} className="text-xs px-2 py-0.5 bg-gray-100 rounded">{t}</span>)}
          </div>
          <div className="prose prose-sm max-w-none max-h-[400px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={handlePreview} disabled={state === 'loading'}>
      {state === 'loading' ? '생성 중...' : '미리보기'}
    </Button>
  )
}
