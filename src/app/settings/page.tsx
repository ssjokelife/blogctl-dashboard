import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { addBlog, deleteBlog } from './actions'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: blogs } = await supabase
    .from('blogs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-gray-50">
      <Header active="settings" />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">설정</h2>

        {/* 프로필 */}
        <Card>
          <CardHeader>
            <CardTitle>내 프로필</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="h-12 w-12 rounded-full" />
              ) : (
                <div className="h-12 w-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-medium text-gray-600">
                  {(profile?.display_name || user.email || '?')[0]}
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900">{profile?.display_name || '이름 없음'}</p>
                <p className="text-sm text-gray-500">{user.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 블로그 관리 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>블로그 관리</span>
              <Badge variant="secondary">{blogs?.length || 0}개</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {blogs && blogs.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>플랫폼</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blogs.map((blog) => (
                    <TableRow key={blog.id}>
                      <TableCell className="font-medium">
                        <a href={`/blogs/${blog.id}`} className="text-emerald-600 hover:underline">{blog.label}</a>
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm font-mono">{blog.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{blog.platform}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-48 truncate">
                        {blog.url || '-'}
                      </TableCell>
                      <TableCell>
                        <form action={deleteBlog}>
                          <input type="hidden" name="blogId" value={blog.id} />
                          <button
                            type="submit"
                            className="text-xs text-red-400 hover:text-red-600 transition-colors"
                          >
                            삭제
                          </button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* 블로그 추가 폼 */}
            <div className="border-t pt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-4">블로그 추가</h3>
              <form action={addBlog} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div className="space-y-1">
                  <label htmlFor="label" className="text-xs text-gray-500">이름</label>
                  <input
                    id="label"
                    name="label"
                    type="text"
                    required
                    placeholder="내 블로그"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="blogId" className="text-xs text-gray-500">ID</label>
                  <input
                    id="blogId"
                    name="blogId"
                    type="text"
                    required
                    placeholder="myblog"
                    pattern="[a-zA-Z0-9]+"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="platform" className="text-xs text-gray-500">플랫폼</label>
                  <select
                    id="platform"
                    name="platform"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="tistory">티스토리</option>
                    <option value="naver">네이버</option>
                    <option value="wordpress">워드프레스</option>
                    <option value="other">기타</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="url" className="text-xs text-gray-500">URL</label>
                  <input
                    id="url"
                    name="url"
                    type="url"
                    placeholder="https://myblog.tistory.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  추가
                </button>
              </form>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
