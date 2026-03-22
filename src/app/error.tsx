'use client'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-4 px-6">
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <span className="text-2xl text-red-600">!</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">문제가 발생했습니다</h2>
        <p className="text-sm text-gray-500 max-w-md">
          {error.message || '알 수 없는 오류가 발생했습니다. 다시 시도해주세요.'}
        </p>
        <Button onClick={reset} variant="outline">
          다시 시도
        </Button>
      </div>
    </div>
  )
}
