'use client'

import { useState } from 'react'

interface Candidate {
  title: string
  action: string
  suggestion: string
  priority: string
  reason: string
}

export function RenovatePanel({ blogId }: { blogId: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)

  const handleAnalyze = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/renovate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId }),
      })
      const data = await res.json()
      setCandidates(data.candidates || [])
    } catch {
      setCandidates([])
    }
    setLoading(false)
  }

  const actionLabel: Record<string, string> = {
    update: '업데이트',
    merge: '통합',
    rewrite: '재작성',
  }

  const priorityStyle: Record<string, string> = {
    high: 'bg-red-100 text-red-600',
    medium: 'bg-amber-100 text-amber-600',
    low: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          loading
            ? 'bg-gray-100 text-gray-400 cursor-wait'
            : 'bg-amber-600 text-white hover:bg-amber-700'
        }`}
      >
        {loading ? 'AI 분석 중...' : '리노베이션 분석'}
      </button>

      {candidates.length > 0 && (
        <div className="border rounded-lg divide-y">
          {candidates.map((c, i) => (
            <div key={i} className="px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${priorityStyle[c.priority] || priorityStyle.low}`}>
                  {c.priority === 'high' ? '높음' : c.priority === 'medium' ? '중간' : '낮음'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-600">
                  {actionLabel[c.action] || c.action}
                </span>
                <span className="font-medium text-sm truncate">{c.title}</span>
              </div>
              <p className="text-sm text-emerald-700">{c.suggestion}</p>
              <p className="text-xs text-gray-400">{c.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
