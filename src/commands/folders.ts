import { Command } from 'commander'

import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type { RelayApiFolderNode, RelayApiFoldersResponse } from '../transport/types.js'

type FolderListOptions = {
  workspace?: string
  tree?: boolean
}

type FolderListRecord = {
  path: string
  parentPath: string | null
  bundleCount: number
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
      const response = await client.requestJson<RelayApiFoldersResponse>({
        path: `/api/workspaces/${workspace.id}/folders`,
        accessToken,
      })
      const flattened = flattenFolders(response.data.folders)

      if (runtime.options.json) {
        runtime.output.writeJson(flattened)
        return
      }

      if (options.tree) {
        runtime.output.writeLine('/')
        for (const line of renderTree(response.data.folders)) {
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

function flattenFolders(folders: RelayApiFolderNode[], parentPath = '/'): FolderListRecord[] {
  const records: FolderListRecord[] = []

  for (const folder of folders) {
    const path = joinFolderPath(parentPath, folder.name)
    records.push({
      path,
      parentPath: parentPath === '/' ? null : parentPath,
      bundleCount: folder.bundleCount,
    })
    records.push(...flattenFolders(folder.children, path))
  }

  return records.sort((left, right) => left.path.localeCompare(right.path))
}

function renderTree(folders: RelayApiFolderNode[], prefix = ''): string[] {
  const lines: string[] = []

  folders.forEach((folder, index) => {
    const isLast = index === folders.length - 1
    const connector = isLast ? '└─' : '├─'
    lines.push(`${prefix}${connector} ${folder.name} (${folder.bundleCount})`)
    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`
    lines.push(...renderTree(folder.children, childPrefix))
  })

  return lines
}

function joinFolderPath(parentPath: string, name: string) {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
}