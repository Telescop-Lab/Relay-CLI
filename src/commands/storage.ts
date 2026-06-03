import { Command } from 'commander'

import { formatBytes } from '../lib/formatting.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import type { RelayApiStorageStatsResponse } from '../transport/types.js'

export function createStorageCommand() {
  const storage = new Command('storage')
    .description('Inspect Relay storage usage')

  storage
    .command('stats')
    .description('Show current storage consumption and quota')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const response = await client.requestJson<RelayApiStorageStatsResponse>({
        path: '/api/storage/stats',
        accessToken,
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data)
        return
      }

      runtime.output.writeLine(
        `used: ${formatBytes(response.data.usedBytes)} / ${formatBytes(response.data.quotaBytes)} (${response.data.percentage}%)`,
      )

      if (response.data.workspaces.length > 0) {
        runtime.output.writeLine()
        runtime.output.writeTable(
          response.data.workspaces.map((workspace) => ({
            name: workspace.name,
            id: workspace.id,
            used: formatBytes(workspace.usedBytes),
          })),
        )
      }
    })

  return storage
}