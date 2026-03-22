import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-4 px-6">
        <div className="text-6xl font-bold text-gray-200">404</div>
        <h2 className="text-xl font-semibold text-gray-900">페이지를 찾을 수 없습니다</h2>
        <p className="text-sm text-gray-500">요청하신 페이지가 존재하지 않거나 이동되었습니다.</p>
        <a href="/">
          <Button variant="outline">대시보드로 돌아가기</Button>
        </a>
      </div>
    </div>
  )
}
