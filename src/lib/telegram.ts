const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

export async function sendTelegramNotification(message: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function formatPublishNotification(blogLabel: string, title: string, keyword: string) {
  return `📝 <b>새 글 생성 완료</b>

🏷 블로그: ${blogLabel}
📌 키워드: ${keyword}
📄 제목: ${title}

via BlogCtl Dashboard`
}
