import type { CliRuntime } from './runtime.js'
import { CliError } from './errors.js'
import { ExitCode } from './exit-codes.js'
import { RelayHttpClient } from '../transport/http-client.js'

export function createServiceClient(runtime: CliRuntime, serviceUrl = runtime.config.requireServiceUrl()) {
  return {
    serviceUrl,
    client: new RelayHttpClient(serviceUrl, {
      debug: runtime.options.debug,
      onTokenExpired: () => refreshAccessToken(runtime, serviceUrl),
    }),
  }
}

async function refreshAccessToken(runtime: CliRuntime, serviceUrl: string): Promise<string> {
  const refreshToken = await runtime.credentials.getRefreshToken(serviceUrl)
  if (!refreshToken) {
    throw new CliError('Session expired — please log in again', {
      code: 'AUTH_REQUIRED',
      exitCode: ExitCode.AuthFailure,
    })
  }

  const res = await fetch(`${serviceUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })

  if (!res.ok) {
    // Refresh token is also expired or revoked
    await runtime.credentials.setAccessToken(serviceUrl, null)
    await runtime.credentials.setRefreshToken(serviceUrl, null)
    throw new CliError('Session expired — please log in again', {
      code: 'AUTH_REQUIRED',
      exitCode: ExitCode.AuthFailure,
    })
  }

  const data = await res.json() as { token?: string; refreshToken?: string }
  if (!data.token) {
    throw new CliError('Session expired — please log in again', {
      code: 'AUTH_REQUIRED',
      exitCode: ExitCode.AuthFailure,
    })
  }

  await runtime.credentials.setAccessToken(serviceUrl, data.token)
  if (data.refreshToken) {
    await runtime.credentials.setRefreshToken(serviceUrl, data.refreshToken)
  }

  return data.token
}

export async function requireAuthenticatedService(runtime: CliRuntime) {
  const { serviceUrl, client } = createServiceClient(runtime)
  const accessToken = await runtime.credentials.getAccessToken(serviceUrl)

  if (!accessToken) {
    throw new CliError('No active Relay session for the configured service', {
      code: 'AUTH_REQUIRED',
      exitCode: ExitCode.AuthFailure,
      hint: 'Run relay login first, or set RELAY_TOKEN for one-off scripted access.',
    })
  }

  return {
    serviceUrl,
    client,
    accessToken,
  }
}