import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { addBlog, skipOnboarding } from './actions'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 이미 블로그가 있으면 대시보드로
  const { count } = await supabase
    .from('blogs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (count && count > 0) redirect('/')

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-emerald-600 flex items-center justify-center text-lg font-bold text-white">B</div>
          <h1 className="text-2xl font-bold text-gray-900">BlogCtl에 오신 것을 환영합니다</h1>
          <p className="text-gray-500">블로그를 등록하고 키워드·발행·수익을 관리하세요.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>첫 번째 블로그 등록</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addBlog} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="label" className="text-sm font-medium text-gray-700">블로그 이름</label>
                <input
                  id="label"
                  name="label"
                  type="text"
                  required
                  placeholder="예: 내 IT 블로그"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="blogId" className="text-sm font-medium text-gray-700">블로그 ID</label>
                <input
                  id="blogId"
                  name="blogId"
                  type="text"
                  required
                  placeholder="예: myblog (영문 소문자, 숫자만)"
                  pattern="[a-zA-Z0-9]+"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <p className="text-xs text-gray-400">내부 식별용 ID입니다. 나중에 변경할 수 없습니다.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="url" className="text-sm font-medium text-gray-700">블로그 URL</label>
                <input
                  id="url"
                  name="url"
                  type="url"
                  placeholder="https://myblog.tistory.com"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="platform" className="text-sm font-medium text-gray-700">플랫폼</label>
                <select
                  id="platform"
                  name="platform"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="tistory">티스토리</option>
                  <option value="naver">네이버 블로그</option>
                  <option value="wordpress">워드프레스</option>
                  <option value="other">기타</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                블로그 등록하고 시작하기
              </button>
            </form>
          </CardContent>
        </Card>

        <form action={skipOnboarding} className="text-center">
          <button type="submit" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            나중에 등록하기
          </button>
        </form>
      </div>
    </div>
  )
}
