interface FixHtmlOptions {
  keyword: string
  blogId?: string
  blogUrl?: string
}

export function fixHtml(html: string, options: FixHtmlOptions): string {
  let result = html

  // 1. Convert markdown links [text](url) → <a> tags
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')

  // 2. Remove tracking params (utm_*)
  result = result.replace(/([?&])utm_[^&]+/g, (_, prefix) => {
    return prefix === '?' ? '?' : ''
  })
  result = result.replace(/\?&/g, '?').replace(/\?$/g, '')

  // 3. Fix external links — add target="_blank" rel="noopener noreferrer"
  result = result.replace(
    /<a\s+href="(https?:\/\/[^"]*)"(?![^>]*target=)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"'
  )

  // 4. Remove broken images (./images/ paths)
  result = result.replace(/<img[^>]*src="\.\/images\/[^"]*"[^>]*>/gi, '')

  // 5. Remove empty tags (repeat for nested)
  result = result.replace(/<(p|div|span)>\s*<\/\1>/gi, '')
  result = result.replace(/<(p|div|span)>\s*<\/\1>/gi, '')

  // 6. Remove dead links (href="#" or href="")
  result = result.replace(/<a\s+href=["'](#|)["'][^>]*>(.*?)<\/a>/gi, '$2')

  // 7. Fix dynamic year — replace old years with current
  const currentYear = new Date().getFullYear()
  for (let year = 2020; year < currentYear - 1; year++) {
    result = result.replace(new RegExp(`${year}년`, 'g'), `${currentYear}년`)
    result = result.replace(new RegExp(`${year}(\\s)`, 'g'), `${currentYear}$1`)
  }

  // 8. Ensure H1 contains keyword (if H1 exists)
  const h1Match = result.match(/<h1[^>]*>(.*?)<\/h1>/i)
  if (h1Match && !h1Match[1].includes(options.keyword)) {
    const keywordWords = options.keyword.split(' ')
    const h1HasKeyword = keywordWords.some(w => h1Match[1].includes(w))
    if (!h1HasKeyword) {
      result = result.replace(
        /<h1([^>]*)>(.*?)<\/h1>/i,
        `<h1$1>${options.keyword} - $2</h1>`
      )
    }
  }

  // 9. Wrap tables for mobile
  result = result.replace(
    /(<table(?![^>]*class="[^"]*mobile)[^>]*>[\s\S]*?<\/table>)/gi,
    '<div style="overflow-x:auto">$1</div>'
  )
  // Avoid double-wrapping
  result = result.replace(
    /<div style="overflow-x:auto"><div style="overflow-x:auto">/g,
    '<div style="overflow-x:auto">'
  )

  // 10. Ensure current year mentioned at least once
  const yearRegex = new RegExp(`${currentYear}`, 'g')
  const yearMentions = (result.match(yearRegex) || []).length
  if (yearMentions === 0) {
    result = result.replace(/<h2([^>]*)>(.*?)<\/h2>/i, `<h2$1>$2 (${currentYear})</h2>`)
  }

  // 11. Add internal blog links if fewer than 2 exist (Medium 8)
  if (options.blogUrl) {
    const escapedUrl = options.blogUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const internalLinkCount = (result.match(new RegExp(escapedUrl, 'gi')) || []).length
    if (internalLinkCount < 2) {
      const blogHome = options.blogUrl.startsWith('http') ? options.blogUrl : `https://${options.blogUrl}`
      const linkHtml = `<p style="margin-top:2em;padding:1em;background:#f8f9fa;border-radius:8px;font-size:0.9em">
<strong>관련 글 더 보기</strong><br>
<a href="${blogHome}" target="_blank" rel="noopener noreferrer">${blogHome.replace('https://', '')} 블로그 홈</a>
</p>`
      if (result.includes('</article>')) {
        result = result.replace('</article>', `${linkHtml}</article>`)
      } else {
        result += linkHtml
      }
    }
  }

  return result
}
