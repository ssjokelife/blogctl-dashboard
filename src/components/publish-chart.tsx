'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface ChartData {
  date: string
  count: number
}

export function PublishChart({ data }: { data: ChartData[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-8">데이터 없음</p>

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}
          labelStyle={{ fontWeight: 600 }}
          formatter={(value: number) => [`${value}건`, '발행']}
        />
        <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
