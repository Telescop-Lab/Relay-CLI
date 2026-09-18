import type { SessionSummary } from '../domain/session.js'
import type { RelayApiDevice, RelayApiUser } from '../transport/types.js'
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
  profile?: string
}

export async function persistAuthenticatedSession(options: PersistAuthenticatedSessionOptions) {
  const profile = options.profile ?? options.runtime.profile

  await options.runtime.credentials.setServiceUrl(profile, options.serviceUrl)
  await options.runtime.credentials.setAccessToken(profile, options.accessToken)

  if (options.refreshToken) {
    await options.runtime.credentials.setRefreshToken(profile, options.refreshToken)
  }

  if (options.bindingSecret) {
    await options.runtime.credentials.setDeviceBinding({
      profile,
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
    profile,
  })

  return summary
}

export async function refreshSessionSummary(options: {
  runtime: CliRuntime
  serviceUrl: string
  user: RelayApiUser
  device: RelayApiDevice
  profile?: string
}) {
  const profile = options.profile ?? options.runtime.profile
  const binding = await options.runtime.credentials.getDeviceBinding({
    profile,
    userId: options.user.id,
    deviceId: options.device.id,
  })

  const summary = createSessionSummary({
    profile,
    serviceUrl: options.serviceUrl,
    user: options.user,
    device: options.device,
    hasBinding: Boolean(binding),
  })
  options.runtime.credentials.setSessionSummary(summary)

  return summary
}

export function createSessionSummary(
  options: SessionIdentity & { profile: string; hasBinding: boolean },
): SessionSummary {
  return {
    profile: options.profile,
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
  profile: string
  serviceUrl: string
  user: RelayApiUser
  device: RelayApiDevice
  defaultWorkspace: string | null
  hasDeviceBinding: boolean
}) {
  return {
    profile: options.profile,
    serviceUrl: options.serviceUrl,
    user: options.user,
    device: options.device,
    defaultWorkspace: options.defaultWorkspace,
    hasDeviceBinding: options.hasDeviceBinding,
  }
}
