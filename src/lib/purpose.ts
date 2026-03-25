export type BlogPurpose = 'adsense' | 'coupang' | 'naver_experience'

export const PURPOSE_LABELS: Record<BlogPurpose, string> = {
  adsense: '애드센스',
  coupang: '쿠팡 파트너스',
  naver_experience: '네이버 체험단',
}

export const PURPOSE_COLORS: Record<BlogPurpose, string> = {
  adsense: 'bg-blue-100 text-blue-700',
  coupang: 'bg-orange-100 text-orange-700',
  naver_experience: 'bg-green-100 text-green-700',
}
