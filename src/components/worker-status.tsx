'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function WorkerStatus() {
  const [online, setOnline] = useState<boolean | null>(null)
  const lastSeenRef = useRef<string | null>(null)

  // Realtime 구독 (한 번만)
  useEffect(() => {
    const supabase = createClient()

    async function checkStatus() {
      const { data } = await supabase
        .from('worker_heartbeats')
        .select('last_heartbeat_at, status')
        .order('last_heartbeat_at', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        const elapsed = Date.now() - new Date(data.last_heartbeat_at).getTime()
        setOnline(elapsed < 60_000)
        lastSeenRef.current = data.last_heartbeat_at
      } else {
        setOnline(false)
      }
    }

    checkStatus()

    const channel = supabase
      .channel('worker-heartbeats')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'worker_heartbeats',
      }, (payload) => {
        const row = payload.new as { last_heartbeat_at: string; status: string }
        if (row) {
          setOnline(true)
          lastSeenRef.current = row.last_heartbeat_at
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // 오프라인 체크 타이머 (별도 effect)
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastSeenRef.current) {
        const elapsed = Date.now() - new Date(lastSeenRef.current).getTime()
        if (elapsed > 60_000) setOnline(false)
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (online === null) return null

  return (
    <div className="flex items-center gap-1.5" title={lastSeenRef.current ? `마지막: ${new Date(lastSeenRef.current).toLocaleTimeString()}` : '워커 미연결'}>
      <div className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      <span className="text-xs text-gray-400">워커</span>
    </div>
  )
}
