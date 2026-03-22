import { google } from 'googleapis'

const SCOPES = ['https://www.googleapis.com/auth/indexing']

async function getAuthClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set')

  const key = JSON.parse(keyJson)
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  })
  return auth
}

export async function requestIndexing(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthClient()
    const indexing = google.indexing({ version: 'v3', auth })

    await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: 'URL_UPDATED',
      },
    })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}
