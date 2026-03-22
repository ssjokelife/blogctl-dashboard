interface QualityCheck {
  name: string
  score: number
  maxScore: number
  passed: boolean
  suggestion?: string
}

export interface QualityResult {
  totalScore: number
  maxScore: number
  passed: boolean
  checks: QualityCheck[]
  suggestions: string[]
}

export function validateContent(html: string, keyword: string, adapter?: string): QualityResult {
  const checks: QualityCheck[] = []
  const suggestions: string[] = []

  // 1. Content volume (15 points)
  const textContent = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const charCount = textContent.length
  let volumeScore = 0
  if (charCount >= 3000) volumeScore = 15
  else if (charCount >= 2000) volumeScore = 12
  else if (charCount >= 1500) volumeScore = 8
  else if (charCount >= 1000) volumeScore = 5
  else volumeScore = 2
  checks.push({
    name: '콘텐츠 분량',
    score: volumeScore,
    maxScore: 15,
    passed: volumeScore >= 10,
    suggestion: charCount < 2000 ? `현재 ${charCount}자 — 최소 2000자 이상 권장` : undefined,
  })

  // 2. Keyword density (15 points)
  const keywordCount = (textContent.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
  const density = charCount > 0 ? (keywordCount * keyword.length / charCount * 100) : 0
  let densityScore = 0
  if (density >= 1 && density <= 3) densityScore = 15
  else if (density > 0.5 && density < 5) densityScore = 10
  else if (keywordCount >= 2) densityScore = 5
  else densityScore = 2
  checks.push({
    name: '키워드 밀도',
    score: densityScore,
    maxScore: 15,
    passed: densityScore >= 10,
    suggestion: keywordCount < 3 ? `키워드 "${keyword}" ${keywordCount}회 사용 — 3~5회 권장` : undefined,
  })

  // 3. Heading structure (15 points)
  const h2Count = (html.match(/<h2/gi) || []).length
  const h3Count = (html.match(/<h3/gi) || []).length
  let headingScore = 0
  if (h2Count >= 3 && h3Count >= 2) headingScore = 15
  else if (h2Count >= 3) headingScore = 12
  else if (h2Count >= 2) headingScore = 8
  else if (h2Count >= 1) headingScore = 5
  else headingScore = 0
  checks.push({
    name: '제목 구조',
    score: headingScore,
    maxScore: 15,
    passed: headingScore >= 8,
    suggestion: h2Count < 3 ? `H2 ${h2Count}개 — 3개 이상 권장` : undefined,
  })

  // 4. Paragraph structure (10 points)
  const pCount = (html.match(/<p/gi) || []).length
  let pScore = 0
  if (pCount >= 8) pScore = 10
  else if (pCount >= 5) pScore = 7
  else if (pCount >= 3) pScore = 4
  else pScore = 2
  checks.push({
    name: '문단 구조',
    score: pScore,
    maxScore: 10,
    passed: pScore >= 7,
    suggestion: pCount < 5 ? `문단 ${pCount}개 — 자연스러운 문단 분리 필요` : undefined,
  })

  // 5. List usage (10 points)
  const listCount = (html.match(/<(ul|ol)/gi) || []).length
  const listScore = listCount >= 2 ? 10 : listCount >= 1 ? 7 : 3
  checks.push({
    name: '목록 활용',
    score: listScore,
    maxScore: 10,
    passed: listScore >= 7,
    suggestion: listCount === 0 ? '목록(ul/ol) 사용으로 가독성 향상 권장' : undefined,
  })

  // 6. Strong/emphasis usage (5 points)
  const strongCount = (html.match(/<(strong|em|b)/gi) || []).length
  const emphasisScore = strongCount >= 3 ? 5 : strongCount >= 1 ? 3 : 1
  checks.push({
    name: '강조 표현',
    score: emphasisScore,
    maxScore: 5,
    passed: emphasisScore >= 3,
    suggestion: strongCount === 0 ? '핵심 내용에 <strong> 강조 사용 권장' : undefined,
  })

  // 7. Link quality (10 points)
  const linkCount = (html.match(/<a\s/gi) || []).length
  const linkScore = linkCount >= 3 ? 10 : linkCount >= 1 ? 6 : 2
  checks.push({
    name: '링크 품질',
    score: linkScore,
    maxScore: 10,
    passed: linkScore >= 6,
    suggestion: linkCount === 0 ? '관련 링크 추가 권장' : undefined,
  })

  // 8. CTA presence (10 points)
  const hasCta = /<(blockquote|div[^>]*class="[^"]*(?:cta|highlight|tip|info)[^"]*"|strong)[^>]*>/i.test(html)
  const ctaScore = hasCta ? 10 : 3
  checks.push({
    name: 'CTA/요약',
    score: ctaScore,
    maxScore: 10,
    passed: ctaScore >= 6,
    suggestion: !hasCta ? '마무리 요약 또는 행동 유도(CTA) 섹션 추가 권장' : undefined,
  })

  // 9. First paragraph hook (5 points)
  const firstP = html.match(/<p[^>]*>(.*?)<\/p>/i)
  const hookLength = firstP ? firstP[1].replace(/<[^>]+>/g, '').length : 0
  const hookScore = hookLength >= 50 ? 5 : hookLength >= 20 ? 3 : 1
  checks.push({
    name: '도입부',
    score: hookScore,
    maxScore: 5,
    passed: hookScore >= 3,
    suggestion: hookLength < 50 ? '도입부를 50자 이상으로 작성하여 독자 관심 유도' : undefined,
  })

  // 10. Conclusion section (5 points)
  const hasConclusion = /(마무리|정리|요약|결론|마치며|핵심)/i.test(html)
  const conclusionScore = hasConclusion ? 5 : 1
  checks.push({
    name: '마무리 섹션',
    score: conclusionScore,
    maxScore: 5,
    passed: conclusionScore >= 3,
    suggestion: !hasConclusion ? '글 마지막에 정리/요약 섹션 추가 권장' : undefined,
  })

  // Calculate totals
  const totalScore = checks.reduce((sum, c) => sum + c.score, 0)
  const maxScore = checks.reduce((sum, c) => sum + c.maxScore, 0)

  // Collect suggestions from failed checks
  checks.forEach(c => {
    if (!c.passed && c.suggestion) suggestions.push(c.suggestion)
  })

  // Threshold: 70 for affiliate, 75 for regular
  const threshold = adapter === 'coupang' ? 70 : 75
  const percentage = Math.round(totalScore / maxScore * 100)
  const passed = percentage >= threshold

  return {
    totalScore: percentage,
    maxScore: 100,
    passed,
    checks,
    suggestions,
  }
}
