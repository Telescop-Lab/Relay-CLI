import { Command } from 'commander'

import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import type { RelayApiDevicesResponse } from '../transport/types.js'

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
          lastSeenAt: device.lastSeenAt ?? '-',
          revokedAt: device.revokedAt ?? '-',
        })),
      )
    })

  return devices
}