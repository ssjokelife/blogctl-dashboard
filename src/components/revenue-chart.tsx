'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface RevenueData {
  date: string
  adsense: number
  coupang: number
}

export function RevenueChart({ data }: { data: RevenueData[] }) {
  if (!data.length) {
    return <p className="text-sm text-gray-400 text-center py-8">수익 데이터가 없습니다.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₩${v.toLocaleString()}`} />
        <Tooltip
          formatter={(value: number, name: string) => [
            `₩${value.toLocaleString()}`,
            name === 'adsense' ? '애드센스' : '쿠팡',
          ]}
        />
        <Legend formatter={(value) => value === 'adsense' ? '애드센스' : '쿠팡'} />
        <Bar dataKey="adsense" fill="#4ade80" radius={[2, 2, 0, 0]} />
        <Bar dataKey="coupang" fill="#60a5fa" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
