'use client'

import { useState } from 'react'

interface Suggestion {
  keyword: string
  category: string
  priority: string
  reason: string
}

export function KeywordSuggest({ blogId, onAdd }: { blogId: string; onAdd?: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<Set<string>>(new Set())

  const handleSuggest = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/keywords/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId }),
      })
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch {
      setSuggestions([])
    }
    setLoading(false)
  }

  const handleAdd = async (s: Suggestion) => {
    setAdding(prev => new Set(prev).add(s.keyword))

    const formData = new FormData()
    formData.set('blogId', blogId)
    formData.set('keyword', s.keyword)
    formData.set('category', s.category || '')
    formData.set('priority', s.priority || 'medium')

    await fetch(`/blogs/${blogId}`, {
      method: 'POST',
      body: formData,
    })

    // Server Action 대신 직접 API 호출
    await fetch('/api/keywords/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blogId,
        keyword: s.keyword,
        category: s.category,
        priority: s.priority,
      }),
    })

    setAdding(prev => {
      const next = new Set(prev)
      next.delete(s.keyword)
      return next
    })
    setSuggestions(prev => prev.filter(x => x.keyword !== s.keyword))
    onAdd?.()
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleSuggest}
        disabled={loading}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          loading
            ? 'bg-gray-100 text-gray-400 cursor-wait'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
      >
        {loading ? 'AI 분석 중...' : 'AI 키워드 추천'}
      </button>

      {suggestions.length > 0 && (
        <div className="border rounded-lg divide-y">
          {suggestions.map((s) => (
            <div key={s.keyword} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{s.keyword}</p>
                <p className="text-xs text-gray-400 truncate">{s.reason}</p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  s.priority === 'high' ? 'bg-red-100 text-red-600' :
                  s.priority === 'medium' ? 'bg-amber-100 text-amber-600' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {s.priority === 'high' ? '높음' : s.priority === 'medium' ? '중간' : '낮음'}
                </span>
                <button
                  onClick={() => handleAdd(s)}
                  disabled={adding.has(s.keyword)}
                  className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {adding.has(s.keyword) ? '추가 중' : '추가'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
