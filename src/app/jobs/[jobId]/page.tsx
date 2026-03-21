import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: job } = await supabase
    .from('publish_jobs')
    .select('*')
    .eq('id', Number(jobId))
    .eq('user_id', user.id)
    .single()

  if (!job) redirect('/')

  const metadata = (job.metadata || {}) as Record<string, unknown>

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="settings" />

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <a href={`/blogs/${job.blog_id}`} className="text-gray-400 hover:text-gray-600 text-sm">&larr; 블로그</a>
          <h2 className="text-2xl font-bold text-gray-900">
            {job.title || metadata.title as string || job.keyword}
          </h2>
          <Badge className={
            job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
            job.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-blue-100 text-blue-700'
          }>
            {job.status === 'completed' ? '완료' : job.status === 'failed' ? '실패' : '진행 중'}
          </Badge>
        </div>

        {/* 메타 정보 */}
        <Card>
          <CardHeader>
            <CardTitle>작업 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500">키워드</p>
                <p className="font-medium">{job.keyword}</p>
              </div>
              <div>
                <p className="text-gray-500">블로그</p>
                <p className="font-medium">{job.blog_id}</p>
              </div>
              <div>
                <p className="text-gray-500">생성일</p>
                <p className="font-mono">{job.created_at?.replace('T', ' ').slice(0, 19)}</p>
              </div>
              <div>
                <p className="text-gray-500">토큰</p>
                <p className="font-mono">{metadata.tokens as number || '-'}</p>
              </div>
              <div>
                <p className="text-gray-500">Telegram</p>
                <p>{job.telegram_sent ? '✅ 전송됨' : '❌ 미전송'}</p>
              </div>
              <div>
                <p className="text-gray-500">콘텐츠 길이</p>
                <p className="font-mono">{job.content_html?.length?.toLocaleString() || 0}자</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 에러 메시지 */}
        {job.error_message && (
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">오류</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm text-red-500 whitespace-pre-wrap">{job.error_message}</pre>
            </CardContent>
          </Card>
        )}

        {/* 콘텐츠 미리보기 */}
        {job.content_html && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>콘텐츠 미리보기</span>
                <button
                  onClick={undefined}
                  className="text-xs text-gray-400"
                >
                  HTML
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700"
                dangerouslySetInnerHTML={{ __html: job.content_html }}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
