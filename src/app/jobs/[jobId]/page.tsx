import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/copy-button'
import { PublishButtonPlatform } from '@/components/publish-button-platform'
import { IndexButton } from '@/components/index-button'

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
  const tags = (metadata.tags as string[]) || []
  const metaDescription = (metadata.meta_description as string) || ''
  const title = job.title || (metadata.title as string) || job.keyword

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="settings" />

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <a href={`/blogs/${job.blog_id}`} className="text-gray-400 hover:text-gray-600 text-sm">&larr; 블로그</a>
          <Badge className={
            job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
            job.status === 'published' ? 'bg-blue-100 text-blue-700' :
            job.status === 'publish_requested' ? 'bg-amber-100 text-amber-700' :
            job.status === 'publishing' ? 'bg-purple-100 text-purple-700' :
            job.status === 'publish_failed' ? 'bg-red-100 text-red-700' :
            job.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-blue-100 text-blue-700'
          }>
            {job.status === 'completed' ? '생성 완료' :
             job.status === 'published' ? '발행됨' :
             job.status === 'publish_requested' ? '발행 대기' :
             job.status === 'publishing' ? '발행 중' :
             job.status === 'publish_failed' ? '발행 실패' :
             job.status === 'failed' ? '생성 실패' : '진행 중'}
          </Badge>
          {job.telegram_sent && <Badge variant="outline">Telegram 전송됨</Badge>}
        </div>

        {(job.status === 'completed' || job.status === 'publish_failed') && (
          <PublishButtonPlatform jobId={job.id} />
        )}

        {/* 에러 */}
        {job.error_message && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-red-600">오류: {job.error_message}</p>
            </CardContent>
          </Card>
        )}

        {job.published_url && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">발행 URL</p>
                  <a href={job.published_url} target="_blank" rel="noopener noreferrer"
                     className="text-emerald-600 hover:underline text-sm">
                    {job.published_url}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton text={job.published_url} label="URL 복사" />
                  <IndexButton jobId={job.id} initialStatus={job.index_status} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {job.sns_status && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500 mb-2">SNS 공유</p>
              <div className="flex gap-3">
                {Object.entries(job.sns_status as Record<string, string>).map(([platform, status]) => (
                  <Badge
                    key={platform}
                    className={status === 'shared' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}
                  >
                    {platform === 'linkedin' ? 'LinkedIn' : platform === 'twitter' ? 'Twitter' : platform}
                    {status === 'shared' ? ' v' : ' x'}
                  </Badge>
                ))}
              </div>
              {job.sns_shared_at && (
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(job.sns_shared_at).toLocaleString('ko-KR')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {job.publish_error && (
          <Card>
            <CardContent className="py-4">
              {job.publish_error_type === 'session_expired' ? (
                <div>
                  <p className="text-sm text-amber-600 font-medium">세션 만료 — 재로그인 필요</p>
                  <p className="text-xs text-gray-500 mt-1">워커 PC에서 blogctl login --blog {job.blog_id} 실행 후 재시도하세요.</p>
                </div>
              ) : (
                <p className="text-sm text-red-600">발행 오류: {job.publish_error}</p>
              )}
              {job.publish_attempts > 0 && (
                <p className="text-xs text-gray-400 mt-1">시도 횟수: {job.publish_attempts}/3</p>
              )}
            </CardContent>
          </Card>
        )}

        {job.content_html && (
          <>
            {/* 1. 제목 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-gray-500">제목</CardTitle>
                  <CopyButton text={title} label="제목 복사" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-gray-900">{title}</p>
              </CardContent>
            </Card>

            {/* 2. 메타 설명 */}
            {metaDescription && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-gray-500">메타 설명 (SEO)</CardTitle>
                    <CopyButton text={metaDescription} label="복사" />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700">{metaDescription}</p>
                  <p className="text-xs text-gray-400 mt-1">{metaDescription.length}자</p>
                </CardContent>
              </Card>
            )}

            {/* 3. 태그 */}
            {tags.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-gray-500">태그</CardTitle>
                    <CopyButton text={tags.join(', ')} label="태그 복사" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="px-3 py-1 rounded-full bg-gray-100 text-sm text-gray-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 4. 본문 HTML */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-gray-500">
                    본문 ({job.content_html.length.toLocaleString()}자)
                  </CardTitle>
                  <div className="flex gap-2">
                    <CopyButton text={job.content_html} label="HTML 복사" />
                    <CopyButton
                      text={job.content_html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}
                      label="텍스트만 복사"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700 prose-code:text-emerald-700 prose-code:bg-gray-50 prose-pre:bg-gray-50"
                  dangerouslySetInnerHTML={{ __html: job.content_html }}
                />
              </CardContent>
            </Card>

            {/* 5. 작업 정보 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-gray-500">작업 정보</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400">키워드</p>
                    <p className="font-medium">{job.keyword}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">블로그</p>
                    <p className="font-medium">{job.blog_id}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">생성일</p>
                    <p className="font-mono text-xs">{job.created_at?.replace('T', ' ').slice(0, 19)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">토큰</p>
                    <p className="font-mono">{(metadata.tokens as number) || '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">모델</p>
                    <p className="font-mono">{(metadata.model as string) || '-'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
