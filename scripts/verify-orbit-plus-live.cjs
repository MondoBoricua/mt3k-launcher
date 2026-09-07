const { app, net } = require('electron')
const { createHash, randomBytes } = require('node:crypto')

const SERVICE_URL = process.env.ORBIT_PLUS_SERVICE_URL || 'https://getorbitlauncher.com'

async function main() {
  await app.whenReady()
  const verifier = randomBytes(32).toString('base64url')
  const response = await net.fetch(`${SERVICE_URL}/v1/patreon/device-sessions`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      clientVersion: 'live-check',
      platform: process.platform,
      deviceChallenge: createHash('sha256').update(verifier).digest('base64url')
    })
  })
  const body = await response.json()
  const authorizationUrl = new URL(body.authorizationUrl)
  const pollResponse = await net.fetch(
    `${SERVICE_URL}/v1/patreon/device-sessions/${encodeURIComponent(body.sessionId)}`,
    {
      headers: {
        accept: 'application/json',
        'x-orbit-device-verifier': verifier
      }
    }
  )
  const pollBody = await pollResponse.json()
  console.log(
    JSON.stringify({
      status: response.status,
      sessionCreated: typeof body.sessionId === 'string' && body.sessionId.length > 0,
      authorizationHost: authorizationUrl.host,
      authorizationPath: authorizationUrl.pathname,
      expiresAtPresent: Number.isSafeInteger(body.expiresAt),
      expiresInMs: body.expiresAt - Date.now(),
      pollIntervalMs: body.pollIntervalMs,
      pollStatus: pollResponse.status,
      pollState: pollBody.state
    })
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    process.exitCode = 1
  })
  .finally(() => app.quit())
