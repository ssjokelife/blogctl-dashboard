import type { BlogPurpose } from '@/lib/purpose'
import { adsenseKeywordStrategy } from './adsense'
import { coupangKeywordStrategy } from './coupang'
import { naverExperienceKeywordStrategy } from './naver-experience'

const strategies: Record<BlogPurpose, { systemAddendum: string }> = {
  adsense: adsenseKeywordStrategy,
  coupang: coupangKeywordStrategy,
  naver_experience: naverExperienceKeywordStrategy,
}

export function getKeywordStrategy(purpose: string): { systemAddendum: string } {
  return strategies[purpose as BlogPurpose] || strategies.adsense
}
