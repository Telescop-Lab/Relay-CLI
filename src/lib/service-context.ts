import type { CliRuntime } from './runtime.js'
import { CliError } from './errors.js'
import { ExitCode } from './exit-codes.js'
import { RelayHttpClient } from '../transport/http-client.js'

export function createServiceClient(runtime: CliRuntime, serviceUrl = runtime.config.requireServiceUrl()) {
  return {
    serviceUrl,
    client: new RelayHttpClient(serviceUrl, {
      debug: runtime.options.debug,
    }),
  }
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