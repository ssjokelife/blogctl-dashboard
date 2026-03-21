import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

export async function Header({ active }: { active: 'dashboard' | 'keywords' | 'publish-log' | 'settings' }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const navItems = [
    { href: '/', label: '대시보드', id: 'dashboard' as const },
    { href: '/keywords', label: '키워드', id: 'keywords' as const },
    { href: '/publish-log', label: '발행 로그', id: 'publish-log' as const },
    { href: '/settings', label: '설정', id: 'settings' as const },
  ]

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email

  return (
    <header className="bg-white border-b px-6 py-4">
      <div className="mx-auto max-w-7xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold text-white">B</div>
          <h1 className="text-lg font-semibold text-gray-900">BlogCtl</h1>
        </div>
        <div className="flex items-center gap-6">
          <nav className="flex gap-6 text-sm">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={item.id === active ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {user && (
            <div className="flex items-center gap-3 border-l pl-4">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                  {(displayName || '?')[0]}
                </div>
              )}
              <span className="text-sm text-gray-600 hidden md:block">{displayName}</span>
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
