import { Command } from 'commander'

import { persistAuthenticatedSession, refreshSessionSummary, sessionPayload } from '../lib/auth-session.js'
import { CliError } from '../lib/errors.js'
import { readPassword, readStdin, promptText } from '../lib/prompts.js'
import { createServiceClient, requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import type { ResponseEnvelope } from '../transport/http-client.js'
import type {
  RelayApiAuthMeResponse,
  RelayApiAuthSessionResponse,
  RelayApiDevicesResponse,
  RelayApiForgetDeviceResponse,
  RelayApiLoginResponse,
  RelayApiSuccessResponse,
} from '../transport/types.js'

type SignupOptions = {
  username: string
  device: string
  passwordStdin?: boolean
}

type LoginOptions = {
  identifier: string
  device?: string
  passwordStdin?: boolean
}

type LogoutOptions = {
  forgetDevice?: boolean
}

export function createSignupCommand() {
  return new Command('signup')
    .description('Register a Relay account and enroll this CLI environment as a device')
    .requiredOption('--username <username>', 'Username to register')
    .requiredOption('--device <device-name>', 'Stable device name for this CLI environment')
    .option('--password-stdin', 'Read the password from stdin')
    .action(async (options: SignupOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { serviceUrl, client } = createServiceClient(runtime)
      const password = await resolvePassword({
        passwordStdin: Boolean(options.passwordStdin),
        confirm: true,
      })

      const response = await client.requestJson<RelayApiAuthSessionResponse>({
        method: 'POST',
        path: '/api/auth/signup',
        body: {
          username: options.username,
          password,
          confirmPassword: password,
          deviceName: options.device,
        },
      })
      const bindingSecret = await client.extractDeviceBinding(response.headers)
      const summary = await persistAuthenticatedSession({
        runtime,
        serviceUrl,
        accessToken: response.data.token,
        refreshToken: response.data.refreshToken ?? null,
        user: response.data.user,
        device: response.data.device,
        bindingSecret,
      })
      const payload = sessionPayload({
        serviceUrl,
        user: response.data.user,
        device: response.data.device,
        defaultWorkspace: runtime.config.getDefaultWorkspace(),
        hasDeviceBinding: summary.hasBinding,
      })

      if (runtime.options.json) {
        runtime.output.writeJson(payload)
        return
      }

      runtime.output.writeLine(`Signed up as ${response.data.user.username} on device ${response.data.device.name}`)
      runtime.output.writeLine(`Service URL: ${serviceUrl}`)
    })
}

export function createLoginCommand() {
  return new Command('login')
    .description('Log into Relay and attach this CLI environment as a device')
    .requiredOption('--identifier <username|email>', 'Username or email')
    .option('--device <device-name>', 'Device name to use when the server requires a new device attachment')
    .option('--password-stdin', 'Read the password from stdin')
    .action(async (options: LoginOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { serviceUrl, client } = createServiceClient(runtime)
      const password = await resolvePassword({
        passwordStdin: Boolean(options.passwordStdin),
        confirm: false,
      })
      const rememberedBinding = await runtime.credentials.getDeviceBinding({ serviceUrl })
      const initialResponse = await client.requestJson<RelayApiLoginResponse>({
        method: 'POST',
        path: '/api/auth/login',
        bindingCookie: rememberedBinding,
        body: {
          identifier: options.identifier,
          password,
        },
      })

      if (initialResponse.data.status === 'DEVICE_NAME_REQUIRED') {
        const deviceName = await resolveDeviceName(options.device, initialResponse.data.recentDeviceNames)
        const completedResponse = await client.requestJson<RelayApiAuthSessionResponse>({
          method: 'POST',
          path: '/api/auth/login/complete-device',
          body: {
            loginTicket: initialResponse.data.loginTicket,
            deviceName,
          },
        })

        await finalizeLogin(runtime, serviceUrl, client, completedResponse)
        return
      }

      await finalizeLogin(runtime, serviceUrl, client, initialResponse as ResponseEnvelope<RelayApiAuthSessionResponse>)
    })
}

export function createWhoAmICommand() {
  return new Command('whoami')
    .description('Show the current Relay service, user, device, default workspace, and local binding state')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, serviceUrl, accessToken } = await requireAuthenticatedService(runtime)
      const response = await client.requestJson<RelayApiAuthMeResponse>({
        path: '/api/auth/me',
        accessToken,
      })
      const summary = await refreshSessionSummary({
        runtime,
        serviceUrl,
        user: response.data.user,
        device: response.data.device,
      })
      const payload = sessionPayload({
        serviceUrl,
        user: response.data.user,
        device: response.data.device,
        defaultWorkspace: runtime.config.getDefaultWorkspace(),
        hasDeviceBinding: summary.hasBinding,
      })

      if (runtime.options.json) {
        runtime.output.writeJson(payload)
        return
      }

      runtime.output.writeLine(`Service URL: ${serviceUrl}`)
      runtime.output.writeLine(`User: ${response.data.user.username}`)
      runtime.output.writeLine(`Device: ${response.data.device.name}`)
      runtime.output.writeLine(`Default workspace: ${runtime.config.getDefaultWorkspace() ?? '(none)'}`)
      runtime.output.writeLine(`Local device binding: ${summary.hasBinding ? 'yes' : 'no'}`)
    })
}

export function createLogoutCommand() {
  return new Command('logout')
    .description('Log out of the current Relay session')
    .option('--forget-device', 'Forget the current device binding as part of logout')
    .action(async (options: LogoutOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, serviceUrl, accessToken } = await requireAuthenticatedService(runtime)
      const summary = runtime.credentials.getSessionSummary(serviceUrl) ?? await fetchCurrentSummary(runtime, serviceUrl, client, accessToken)

      if (options.forgetDevice) {
        await client.requestJson<RelayApiForgetDeviceResponse>({
          method: 'POST',
          path: '/api/auth/forget-browser',
          accessToken,
        })

        if (summary?.userId && summary.deviceId) {
          await runtime.credentials.clearDeviceBinding({
            serviceUrl,
            userId: summary.userId,
            deviceId: summary.deviceId,
          })
        }
      }

      await client.requestJson<RelayApiSuccessResponse>({
        method: 'POST',
        path: '/api/auth/logout',
        accessToken,
      })

      await runtime.credentials.setAccessToken(serviceUrl, null)
      if (summary) {
        runtime.credentials.setSessionSummary({
          ...summary,
          updatedAt: new Date().toISOString(),
          hasBinding: options.forgetDevice ? false : summary.hasBinding,
        })
      }

      if (runtime.options.json) {
        runtime.output.writeJson({
          success: true,
          serviceUrl,
          forgotDevice: Boolean(options.forgetDevice),
        })
        return
      }

      runtime.output.writeLine(
        options.forgetDevice
          ? `Logged out from ${serviceUrl} and forgot this device binding`
          : `Logged out from ${serviceUrl}`,
      )
    })
}

async function finalizeLogin(
  runtime: Awaited<ReturnType<typeof getCommandRuntime>>,
  serviceUrl: string,
  client: ReturnType<typeof createServiceClient>['client'],
  response: ResponseEnvelope<RelayApiAuthSessionResponse>,
) {
  const bindingSecret = await client.extractDeviceBinding(response.headers)
  const summary = await persistAuthenticatedSession({
    runtime,
    serviceUrl,
    accessToken: response.data.token,
    refreshToken: response.data.refreshToken ?? null,
    user: response.data.user,
    device: response.data.device,
    bindingSecret,
  })
  const payload = sessionPayload({
    serviceUrl,
    user: response.data.user,
    device: response.data.device,
    defaultWorkspace: runtime.config.getDefaultWorkspace(),
    hasDeviceBinding: summary.hasBinding,
  })

  if (runtime.options.json) {
    runtime.output.writeJson(payload)
    return
  }

  runtime.output.writeLine(`Logged in as ${response.data.user.username} on device ${response.data.device.name}`)
  runtime.output.writeLine(`Service URL: ${serviceUrl}`)
}

async function fetchCurrentSummary(
  runtime: Awaited<ReturnType<typeof getCommandRuntime>>,
  serviceUrl: string,
  client: ReturnType<typeof createServiceClient>['client'],
  accessToken: string,
) {
  const response = await client.requestJson<RelayApiAuthMeResponse>({
    path: '/api/auth/me',
    accessToken,
  })

  return refreshSessionSummary({
    runtime,
    serviceUrl,
    user: response.data.user,
    device: response.data.device,
  })
}

async function resolvePassword(options: { passwordStdin: boolean; confirm: boolean }) {
  if (options.passwordStdin) {
    return trimSingleTrailingNewline(await readStdin())
  }

  return readPassword('Password', options.confirm)
}

async function resolveDeviceName(explicitDevice: string | undefined, recentDeviceNames: string[]) {
  if (explicitDevice?.trim()) {
    return explicitDevice.trim()
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError('This login requires a device name', {
      hint: 'Retry with --device <device-name> in non-interactive mode.',
    })
  }

  if (recentDeviceNames.length > 0) {
    process.stderr.write(`Recent device names: ${recentDeviceNames.join(', ')}\n`)
  }

  const deviceName = await promptText('Device name')
  if (!deviceName) {
    throw new CliError('Device name is required to complete login')
  }

  return deviceName
}

function trimSingleTrailingNewline(value: string) {
  return value.replace(/(?:\r?\n)+$/, '')
}