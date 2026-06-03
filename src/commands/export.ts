import fs from 'node:fs/promises'

import { Command } from 'commander'

import { resolveCliPath } from '../lib/files.js'
import { sanitizeFileName, timestampForFilename } from '../lib/formatting.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type { RelayApiExportSnapshot } from '../transport/types.js'

type ExportOptions = {
  output?: string
}

export function createExportCommand() {
  return new Command('export')
    .description('Export a workspace snapshot to a local JSON file')
    .argument('<workspace-id-or-name>', 'Workspace to export')
    .option('--output <file>', 'Write the export JSON to a specific file')
    .action(async (workspaceReference: string, options: ExportOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: workspaceReference,
        config: runtime.config,
        client,
        accessToken,
      })
      const response = await client.requestJson<RelayApiExportSnapshot>({
        path: `/api/workspaces/${workspace.id}/export`,
        accessToken,
      })
      const outputPath = options.output
        ? resolveCliPath(options.output, runtime.cwd)
        : resolveCliPath(
            `${sanitizeFileName(workspace.name)}-${timestampForFilename(new Date())}.relay-export.json`,
            runtime.cwd,
          )

      await fs.writeFile(outputPath, `${JSON.stringify(response.data, null, 2)}\n`, 'utf8')

      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace,
          output: outputPath,
          formatVersion: response.data.formatVersion ?? null,
          exportedAt: response.data.exportedAt ?? null,
        })
        return
      }

      runtime.output.writeLine(`Exported ${workspace.name} to ${outputPath}`)
    })
}