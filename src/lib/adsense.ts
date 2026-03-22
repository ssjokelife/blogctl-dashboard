import { google } from 'googleapis'

export interface AdSenseData {
  revenue: number  // KRW
  clicks: number
  impressions: number
}

export async function fetchAdSenseData(date: string): Promise<AdSenseData | null> {
  const clientId = process.env.ADSENSE_CLIENT_ID
  const clientSecret = process.env.ADSENSE_CLIENT_SECRET
  const refreshToken = process.env.ADSENSE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) return null

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
    oauth2Client.setCredentials({ refresh_token: refreshToken })

    const adsense = google.adsense({ version: 'v2', auth: oauth2Client })

    // 계정 목록 조회
    const accounts = await adsense.accounts.list()
    const accountId = accounts.data.accounts?.[0]?.name
    if (!accountId) return null

    const report = await adsense.accounts.reports.generate({
      account: accountId,
      dateRange: 'CUSTOM',
      'startDate.year': parseInt(date.slice(0, 4)),
      'startDate.month': parseInt(date.slice(5, 7)),
      'startDate.day': parseInt(date.slice(8, 10)),
      'endDate.year': parseInt(date.slice(0, 4)),
      'endDate.month': parseInt(date.slice(5, 7)),
      'endDate.day': parseInt(date.slice(8, 10)),
      metrics: ['ESTIMATED_EARNINGS', 'CLICKS', 'IMPRESSIONS'],
      currencyCode: 'KRW',
    })

    const row = report.data.rows?.[0]?.cells
    if (!row) return { revenue: 0, clicks: 0, impressions: 0 }

    return {
      revenue: Math.round(parseFloat(row[0]?.value || '0')),
      clicks: parseInt(row[1]?.value || '0'),
      impressions: parseInt(row[2]?.value || '0'),
    }
  } catch (err) {
    console.error('AdSense API error:', err instanceof Error ? err.message : err)
    return null
  }
}
