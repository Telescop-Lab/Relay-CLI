import type { SessionSummary } from '../domain/session.js'
import type { RelayApiAuthSessionResponse, RelayApiDevice, RelayApiUser } from '../transport/types.js'
import type { CliRuntime } from './runtime.js'

type SessionIdentity = {
  serviceUrl: string
  user: RelayApiUser
  device: RelayApiDevice
}

type PersistAuthenticatedSessionOptions = SessionIdentity & {
  runtime: CliRuntime
  accessToken: string
  refreshToken?: string | null
  bindingSecret?: string | null
}

export async function persistAuthenticatedSession(options: PersistAuthenticatedSessionOptions) {
  await options.runtime.credentials.setAccessToken(options.serviceUrl, options.accessToken)

  if (options.refreshToken) {
    await options.runtime.credentials.setRefreshToken(options.serviceUrl, options.refreshToken)
  }

  if (options.bindingSecret) {
    await options.runtime.credentials.setDeviceBinding({
      serviceUrl: options.serviceUrl,
      userId: options.user.id,
      deviceId: options.device.id,
      deviceName: options.device.name,
      secret: options.bindingSecret,
    })
  }

  const summary = await refreshSessionSummary({
    runtime: options.runtime,
    serviceUrl: options.serviceUrl,
    user: options.user,
    device: options.device,
  })

  return summary
}

export async function refreshSessionSummary(options: {
  runtime: CliRuntime
  serviceUrl: string
  user: RelayApiUser
  device: RelayApiDevice
}) {
  const binding = await options.runtime.credentials.getDeviceBinding({
    serviceUrl: options.serviceUrl,
    userId: options.user.id,
    deviceId: options.device.id,
  })

  const summary = createSessionSummary({
    serviceUrl: options.serviceUrl,
    user: options.user,
    device: options.device,
    hasBinding: Boolean(binding),
  })
  options.runtime.credentials.setSessionSummary(summary)

  return summary
}

export function createSessionSummary(options: SessionIdentity & { hasBinding: boolean }): SessionSummary {
  return {
    serviceUrl: options.serviceUrl,
    updatedAt: new Date().toISOString(),
    userId: options.user.id,
    username: options.user.username,
    email: options.user.email,
    deviceId: options.device.id,
    deviceName: options.device.name,
    hasBinding: options.hasBinding,
  }
}

export function sessionPayload(options: {
  serviceUrl: string
  user: RelayApiUser
  device: RelayApiDevice
  defaultWorkspace: string | null
  hasDeviceBinding: boolean
}) {
  return {
    serviceUrl: options.serviceUrl,
    user: options.user,
    device: options.device,
    defaultWorkspace: options.defaultWorkspace,
    hasDeviceBinding: options.hasDeviceBinding,
  }
}

export function sessionFromAuthResponse(response: RelayApiAuthSessionResponse) {
  return {
    accessToken: response.token,
    user: response.user,
    device: response.device,
  }
}