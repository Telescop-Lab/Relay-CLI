import type { CliRuntime } from './runtime.js'
import { CliError } from './errors.js'
import { ExitCode } from './exit-codes.js'
import { RelayHttpClient } from '../transport/http-client.js'

const refreshPromises = new Map<string, Promise<string>>()

export function createServiceClient(runtime: CliRuntime, serviceUrl = runtime.config.requireServiceUrl(runtime.profile)) {
  return {
    serviceUrl,
    client: new RelayHttpClient(serviceUrl, {
      debug: runtime.options.debug,
      onTokenExpired: () => refreshAccessToken(runtime, serviceUrl),
    }),
  }
}

async function refreshAccessToken(runtime: CliRuntime, serviceUrl: string): Promise<string> {
  const profile = runtime.profile
  const inflight = refreshPromises.get(profile)
  if (inflight) {
    return inflight
  }

  const refresh = rotateTokens(runtime, serviceUrl)
  refreshPromises.set(profile, refresh)

  try {
    return await refresh
  } finally {
    refreshPromises.delete(profile)
  }
}

async function rotateTokens(runtime: CliRuntime, serviceUrl: string): Promise<string> {
  const profile = runtime.profile
  const refreshToken = await runtime.credentials.getRefreshToken(profile)
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
    await runtime.credentials.setAccessToken(profile, null)
    await runtime.credentials.setRefreshToken(profile, null)
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

  await runtime.credentials.setAccessToken(profile, data.token)
  if (data.refreshToken) {
    await runtime.credentials.setRefreshToken(profile, data.refreshToken)
  }

  return data.token
}

export async function requireAuthenticatedService(runtime: CliRuntime) {
  const { serviceUrl, client } = createServiceClient(runtime)
  const accessToken = await runtime.credentials.getAccessToken(runtime.profile)

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