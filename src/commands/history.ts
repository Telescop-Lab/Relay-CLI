import { Command } from 'commander'

import { describeHistoryType, formatTimestamp } from '../lib/formatting.js'
import { CliError } from '../lib/errors.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type { RelayApiHistoryResponse } from '../transport/types.js'

type HistoryOptions = {
  workspace?: string
  limit?: string | number
}

export function createHistoryCommand() {
  return new Command('history')
    .description('Show recent workspace history events')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .option('--limit <n>', 'Maximum number of events to return', '20')
    .action(async (options: HistoryOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const response = await client.requestJson<RelayApiHistoryResponse>({
        path: `/api/workspaces/${workspace.id}/history`,
        accessToken,
        query: { limit: parseLimit(options.limit) },
      })

      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace,
          events: response.data.events,
        })
        return
      }

      for (const event of response.data.events) {
        const suffix = event.bundleId ? ` bundle=${event.bundleId}` : ''
        runtime.output.writeLine(
          `${formatTimestamp(event.createdAt)}  ${event.actorName}  ${describeHistoryType(event.type)}${suffix}`,
        )
      }
    })
}

function parseLimit(rawLimit: string | number | undefined) {
  const numeric = Number(rawLimit ?? 20)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('Limit must be a positive integer')
  }

  return numeric
}