'use client'

import { useState } from 'react'

interface NavItem {
  href: string
  label: string
  id: string
}

export function MobileNav({ active, navItems }: { active: string; navItems: NavItem[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-gray-500 hover:text-gray-900"
        aria-label="메뉴"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" />
          ) : (
            <path d="M3 6h14M3 10h14M3 14h14" />
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute top-14 left-0 right-0 bg-white border-b shadow-sm z-50">
          <nav className="flex flex-col px-4 py-2">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`py-3 text-sm border-b border-gray-50 last:border-0 ${
                  item.id === active ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}
