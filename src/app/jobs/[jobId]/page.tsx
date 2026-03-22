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

  // 블로그 정보 (플랫폼 표시용)
  const { data: blog } = await supabase
    .from('blogs')
    .select('platform, label')
    .eq('id', job.blog_id)
    .eq('user_id', user.id)
    .single()

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

        {(job.sns_status || job.index_status) && (
          <Card>
            <CardContent className="py-4 space-y-3">
              {/* SNS 공유 상태 */}
              {job.sns_status && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">SNS 공유</p>
                  <div className="flex gap-2 mb-2">
                    {Object.entries(job.sns_status as Record<string, string>).map(([platform, status]) => (
                      <Badge
                        key={platform}
                        className={status === 'shared' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}
                      >
                        {platform === 'linkedin' ? 'LinkedIn' : platform === 'twitter' ? 'Twitter' : platform}
                        {status === 'shared' ? ' ✓' : ' ✗'}
                      </Badge>
                    ))}
                  </div>
                  {Object.values(job.sns_status as Record<string, string>).some(s => s === 'failed') && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                      <p className="font-medium text-amber-800">SNS 세션 만료</p>
                      <p className="text-amber-700 mt-1">워커 PC에서 세션을 재설정하세요:</p>
                      <code className="block bg-amber-100 rounded px-2 py-1 mt-1 text-xs text-amber-900 font-mono">
                        blogctl login --blog {job.blog_id}
                      </code>
                      <p className="text-amber-600 mt-1 text-xs">브라우저가 열리면 LinkedIn/Twitter에 로그인 후 Enter를 누르세요.</p>
                    </div>
                  )}
                </div>
              )}

              {/* GSC 인덱싱 상태 */}
              {job.index_status && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">GSC 인덱싱</p>
                  <Badge className={
                    job.index_status === 'requested' ? 'bg-emerald-100 text-emerald-700' :
                    job.index_status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-700'
                  }>
                    {job.index_status === 'requested' ? '요청됨' :
                     job.index_status === 'failed' ? '실패' : job.index_status}
                  </Badge>
                  {job.index_status === 'failed' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mt-2">
                      <p className="font-medium text-amber-800">인덱싱 실패</p>
                      <p className="text-amber-700 mt-1">가능한 원인:</p>
                      <ul className="list-disc list-inside text-amber-700 text-xs mt-1 space-y-0.5">
                        <li>GSC 속성에 Service Account가 소유자로 등록되지 않음</li>
                        <li>blogctl-indexing@blogctl.iam.gserviceaccount.com 을 GSC에 추가 필요</li>
                      </ul>
                      <p className="text-amber-600 mt-2 text-xs">수동 인덱싱: 위의 &quot;GSC 인덱싱&quot; 버튼으로 재시도할 수 있습니다.</p>
                    </div>
                  )}
                  {job.indexed_at && (
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(job.indexed_at).toLocaleString('ko-KR')}
                    </p>
                  )}
                </div>
              )}

              {job.sns_shared_at && !job.index_status && (
                <p className="text-xs text-gray-400">
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
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400">키워드</p>
                    <p className="font-medium">{job.keyword}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">블로그</p>
                    <p className="font-medium">{blog?.label || job.blog_id}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">플랫폼</p>
                    <p className="font-medium">
                      {blog?.platform === 'tistory' ? 'Tistory' :
                       blog?.platform === 'naver' ? 'Naver' :
                       blog?.platform === 'wordpress' ? 'WordPress' :
                       blog?.platform === 'blogger' ? 'Blogger' :
                       blog?.platform === 'hashnode' ? 'Hashnode' :
                       blog?.platform === 'devto' ? 'Dev.to' : blog?.platform || '-'}
                    </p>
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
                  <div>
                    <p className="text-gray-400">품질</p>
                    <p className={`font-mono ${(metadata.quality_score as number) >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {(metadata.quality_score as number) || '-'}/100
                    </p>
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
