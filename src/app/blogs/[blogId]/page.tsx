import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { PublishButton } from '@/components/publish-button'
import { updatePersona, addKeyword, updateKeywordStatus, deleteKeyword } from './actions'

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ blogId: string }>
}) {
  const { blogId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: blog } = await supabase
    .from('blogs')
    .select('*')
    .eq('id', blogId)
    .eq('user_id', user.id)
    .single()

  if (!blog) redirect('/settings')

  const { data: keywords } = await supabase
    .from('keywords')
    .select('*')
    .eq('blog_id', blogId)
    .eq('user_id', user.id)
    .order('priority')

  const pending = keywords?.filter(k => k.status === 'pending') || []
  const published = keywords?.filter(k => k.status === 'published') || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="settings" />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <a href="/settings" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 설정</a>
          <h2 className="text-2xl font-bold text-gray-900">{blog.label}</h2>
          <Badge variant="outline">{blog.platform}</Badge>
          {blog.adapter === 'coupang' && <Badge className="bg-orange-100 text-orange-700">쿠팡</Badge>}
        </div>

        {/* 페르소나 설정 */}
        <Card>
          <CardHeader>
            <CardTitle>페르소나</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updatePersona} className="space-y-4">
              <input type="hidden" name="blogId" value={blogId} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">페르소나 이름</label>
                  <input
                    name="persona"
                    defaultValue={blog.persona || ''}
                    placeholder="예: 개발자 테크진"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">타겟 독자</label>
                  <input
                    name="targetAudience"
                    defaultValue={blog.target_audience || ''}
                    placeholder="예: 개발자, IT 실무자"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">블로그 설명</label>
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={blog.description || ''}
                  placeholder="블로그의 목적과 방향"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">스타일</label>
                  <select
                    name="style"
                    defaultValue={blog.style || 'professional'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="professional">전문적</option>
                    <option value="friendly">친근한</option>
                    <option value="casual">캐주얼</option>
                    <option value="casual_warm">따뜻한 캐주얼</option>
                    <option value="conversational">대화체</option>
                    <option value="storytelling">스토리텔링</option>
                    <option value="honest_reviewer">솔직한 리뷰어</option>
                    <option value="warm_storytelling">따뜻한 이야기</option>
                    <option value="patient_teacher">친절한 선생님</option>
                    <option value="motivational_realistic">동기부여 현실파</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">말투</label>
                  <input
                    name="endingForm"
                    defaultValue={blog.ending_form || '~합니다'}
                    placeholder="~합니다, ~해요, ~했어요"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">카테고리</label>
                  <input
                    name="categories"
                    defaultValue={(blog.categories || []).join(', ')}
                    placeholder="카테고리1, 카테고리2"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                페르소나 저장
              </button>
            </form>
          </CardContent>
        </Card>

        {/* 키워드 관리 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>키워드 관리</span>
              <div className="flex gap-2">
                <Badge variant="secondary">대기 {pending.length}</Badge>
                <Badge variant="outline">발행 {published.length}</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 키워드 추가 */}
            <form action={addKeyword} className="flex gap-2 items-end">
              <input type="hidden" name="blogId" value={blogId} />
              <div className="flex-1 space-y-1">
                <label className="text-xs text-gray-500">키워드</label>
                <input
                  name="keyword"
                  required
                  placeholder="새 키워드 입력"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="w-32 space-y-1">
                <label className="text-xs text-gray-500">카테고리</label>
                <select
                  name="category"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">선택안함</option>
                  {(blog.categories || []).map((cat: string) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="w-24 space-y-1">
                <label className="text-xs text-gray-500">우선순위</label>
                <select name="priority" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option value="high">높음</option>
                  <option value="medium" selected>중간</option>
                  <option value="low">낮음</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                추가
              </button>
            </form>

            {/* 대기 키워드 테이블 */}
            {pending.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>키워드</TableHead>
                    <TableHead>카테고리</TableHead>
                    <TableHead>우선순위</TableHead>
                    <TableHead>예상 클릭</TableHead>
                    <TableHead className="w-32">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.slice(0, 50).map((kw) => (
                    <TableRow key={kw.id}>
                      <TableCell className="font-medium">{kw.keyword}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{kw.category || '-'}</TableCell>
                      <TableCell>
                        <Badge className={
                          kw.priority === 'high' ? 'bg-red-100 text-red-700' :
                          kw.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }>
                          {kw.priority === 'high' ? '높음' : kw.priority === 'medium' ? '중간' : '낮음'}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-gray-500">
                        {kw.expected_clicks_4w || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PublishButton blogId={blogId} keywordId={kw.id} keyword={kw.keyword} />
                          <form action={deleteKeyword}>
                            <input type="hidden" name="keywordId" value={kw.id} />
                            <input type="hidden" name="blogId" value={blogId} />
                            <button type="submit" className="text-xs text-red-400 hover:text-red-600">삭제</button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {pending.length > 50 && (
              <p className="text-sm text-gray-400 text-center">외 {pending.length - 50}건</p>
            )}
          </CardContent>
        </Card>
        {/* 발행 작업 이력 */}
        <PublishJobsCard blogId={blogId} userId={user.id} />
      </main>
    </div>
  )
}

async function PublishJobsCard({ blogId, userId }: { blogId: string; userId: string }) {
  const supabase = await createClient()
  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('*')
    .eq('blog_id', blogId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (!jobs || jobs.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>최근 발행 작업</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>키워드</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>제목</TableHead>
              <TableHead>생성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">
                  <a href={`/jobs/${job.id}`} className="text-emerald-600 hover:underline">{job.keyword}</a>
                </TableCell>
                <TableCell>
                  <Badge className={
                    job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    job.status === 'failed' ? 'bg-red-100 text-red-700' :
                    job.status === 'generating' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }>
                    {job.status === 'completed' ? '완료' :
                     job.status === 'failed' ? '실패' :
                     job.status === 'generating' ? '생성 중' : '대기'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-gray-500 max-w-64 truncate">
                  {(job.metadata as { title?: string })?.title || '-'}
                </TableCell>
                <TableCell className="text-sm text-gray-400 tabular-nums">
                  {job.created_at?.replace('T', ' ').slice(0, 16)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
