import { Command } from 'commander'

import { flattenFolderTree, fetchFolderTree, renderFolderTreeLines } from '../lib/folder-tree.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'

type FolderListOptions = {
  workspace?: string
  tree?: boolean
}

export function createFolderCommand() {
  const folder = new Command('folder')
    .description('Inspect workspace folder partitions')

  folder
    .command('list')
    .description('List folder partitions for a workspace')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .option('--tree', 'Print the folder structure as a tree')
    .action(async (options: FolderListOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const folders = await fetchFolderTree(client, accessToken, workspace.id)
      const flattened = flattenFolderTree(folders)

      if (runtime.options.json) {
        runtime.output.writeJson(flattened)
        return
      }

      if (options.tree) {
        runtime.output.writeLine('/')
        for (const line of renderFolderTreeLines(folders)) {
          runtime.output.writeLine(line)
        }
        return
      }

      runtime.output.writeTable(
        flattened.map((folderRecord) => ({
          path: folderRecord.path,
          bundleCount: folderRecord.bundleCount,
        })),
      )
    })

  return folder
}
