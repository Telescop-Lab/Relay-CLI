import { Command } from 'commander'

import { persistAuthenticatedSession } from '../lib/auth-session.js'
import { CliError, isCliError } from '../lib/errors.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import type {
  RelayApiAuthMeResponse,
  RelayApiDeviceCreateResponse,
  RelayApiDeviceRevokeResponse,
  RelayApiDeviceUpdateResponse,
  RelayApiDevicesResponse,
} from '../transport/types.js'

export function createDevicesCommand() {
  const devices = new Command('devices')
    .description('Inspect account devices')

  devices
    .command('list')
    .description('List all devices on the current account')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const response = await client.requestJson<RelayApiDevicesResponse>({
        path: '/api/devices',
        accessToken,
      })

      if (runtime.options.json) {
        runtime.output.writeJson({ devices: response.data.devices })
        return
      }

      runtime.output.writeTable(
        response.data.devices.map((device) => ({
          current: device.isCurrent ? '*' : '',
          id: device.id,
          name: device.name,
          status: device.revokedAt ? 'revoked' : 'active',
          lastSeenAt: device.lastSeenAt ?? '-',
        })),
      )
    })

  devices
    .command('add')
    .description('Register a new device and switch this CLI session to it')
    .requiredOption('--name <device-name>', 'Name for the new device')
    .option('--no-switch', 'Register the device without switching this CLI session to it')
    .action(async (options: { name: string; switch?: boolean }, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, serviceUrl, accessToken } = await requireAuthenticatedService(runtime)

      const created = await client.requestJson<RelayApiDeviceCreateResponse>({
        method: 'POST',
        path: '/api/devices',
        accessToken,
        body: { name: options.name },
      }).catch(rethrowDeviceNameConflict)

      if (options.switch === false) {
        if (runtime.options.json) {
          runtime.output.writeJson({ device: created.data.device })
          return
        }

        runtime.output.writeLine(`Registered device ${created.data.device.name}`)
        return
      }

      const bindingSecret = await client.extractDeviceBinding(created.headers)

      const me = await client.requestJson<RelayApiAuthMeResponse>({
        path: '/api/auth/me',
        accessToken: created.data.token,
      })

      await persistAuthenticatedSession({
        runtime,
        serviceUrl,
        accessToken: created.data.token,
        refreshToken: created.data.refreshToken ?? null,
        user: me.data.user,
        device: created.data.device,
        bindingSecret,
      })

      if (runtime.options.json) {
        runtime.output.writeJson({ device: created.data.device })
        return
      }

      runtime.output.writeLine(`Registered device ${created.data.device.name} and switched this CLI session to it`)
    })

  devices
    .command('rename <device-id>')
    .description('Rename a device on the current account')
    .requiredOption('--name <new-name>', 'New name for the device')
    .action(async (deviceId: string, options: { name: string }, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)

      const response = await client.requestJson<RelayApiDeviceUpdateResponse>({
        method: 'PATCH',
        path: `/api/devices/${deviceId}`,
        accessToken,
        body: { name: options.name },
      }).catch(rethrowDeviceNameConflict)

      if (runtime.options.json) {
        runtime.output.writeJson(response.data)
        return
      }

      const current = response.data.isCurrent ? ' (current device)' : ''
      runtime.output.writeLine(`Renamed device to ${response.data.device.name}${current}`)
    })

  devices
    .command('revoke <device-id>')
    .description('Revoke a device so it can no longer access this account')
    .action(async (deviceId: string, _options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)

      const response = await client.requestJson<RelayApiDeviceRevokeResponse>({
        method: 'POST',
        path: `/api/devices/${deviceId}/revoke`,
        accessToken,
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data)
        return
      }

      runtime.output.writeLine(`Revoked device ${deviceId}`)
    })

  return devices
}

function rethrowDeviceNameConflict(error: unknown): never {
  if (isCliError(error) && error.status === 409) {
    const details = error.details as
      | { code?: string; device?: { id: string; name: string; revokedAt: string | null } }
      | undefined

    if (details?.code === 'DEVICE_NAME_TAKEN' && details.device) {
      const state = details.device.revokedAt ? 'revoked' : 'active'
      const article = state === 'active' ? 'an' : 'a'
      throw new CliError(`Device name "${details.device.name}" is already taken by ${article} ${state} device`, {
        code: 'HTTP_ERROR',
        status: 409,
        details: { code: 'DEVICE_NAME_TAKEN', device: details.device },
        hint: `Free the name by renaming the ${state} device first: relay devices rename ${details.device.id} --name "${details.device.name}-old"`,
      })
    }
  }

  throw error
}