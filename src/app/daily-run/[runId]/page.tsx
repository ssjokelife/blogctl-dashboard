import { getDailyRun } from '@/lib/daily-run'
import { BLOG_LABELS } from '@/lib/data'
import { Header } from '@/components/header'
import { DailyRunDetail } from '@/components/daily-run-detail'
import { redirect } from 'next/navigation'

export default async function DailyRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const result = await getDailyRun(runId)

  if (!result) redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="dashboard" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <DailyRunDetail
          initialRun={result.run}
          initialJobs={result.jobs}
          initialLogs={result.logs}
          blogLabels={BLOG_LABELS}
        />
      </main>
    </div>
  )
}
