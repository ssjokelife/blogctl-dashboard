import crypto from 'crypto'

export interface CoupangData {
  revenue: number  // KRW
  clicks: number
  orders: number
}

function generateHmac(method: string, url: string, accessKey: string, secretKey: string): string {
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const message = datetime + method + url
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}

export async function fetchCoupangData(date: string): Promise<CoupangData | null> {
  const accessKey = process.env.COUPANG_ACCESS_KEY
  const secretKey = process.env.COUPANG_SECRET_KEY

  if (!accessKey || !secretKey) return null

  try {
    const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/reports?startDate=${date}&endDate=${date}`
    const authorization = generateHmac('GET', path, accessKey, secretKey)

    const res = await fetch(`https://api-gateway.coupang.com${path}`, {
      headers: { Authorization: authorization },
    })

    if (!res.ok) {
      console.error('Coupang API error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    const report = data.data

    if (!report) return { revenue: 0, clicks: 0, orders: 0 }

    return {
      revenue: Math.round(report.commission || 0),
      clicks: report.clicks || 0,
      orders: report.orders || 0,
    }
  } catch (err) {
    console.error('Coupang API error:', err instanceof Error ? err.message : err)
    return null
  }
}
