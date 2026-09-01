import { Command } from 'commander'

import {
  buildFolderPathIndex,
  fetchFolderTree,
  flattenFolderTree,
  renderFolderTreeLines,
  resolveFolderPath,
} from '../lib/folder-tree.js'
import { CliError } from '../lib/errors.js'
import { confirm } from '../lib/prompts.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type { RelayHttpClient } from '../transport/http-client.js'
import type {
  RelayApiFolderCreateResponse,
  RelayApiFolderUpdateResponse,
  RelayApiSuccessResponse,
} from '../transport/types.js'

type FolderListOptions = {
  workspace?: string
  tree?: boolean
}

type FolderCreateOptions = {
  parent?: string
  workspace?: string
}

type FolderRenameOptions = {
  name: string
  workspace?: string
}

type FolderMoveOptions = {
  parent: string
  workspace?: string
}

type FolderDeleteOptions = {
  yes?: boolean
  workspace?: string
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

  folder
    .command('create <name>')
    .description('Create a new folder')
    .option('--parent <path>', 'Parent folder path (default: root)', '/')
    .option('--workspace <workspace-id|name>', 'Workspace to modify instead of the local default')
    .action(async (name: string, options: FolderCreateOptions, command: Command) => {
      const folderName = validateFolderName(name)
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      const parent = await resolveParentFolder(client, accessToken, workspace.id, options.parent ?? '/')
      const targetPath = parent.path === '/' ? `/${folderName}` : `${parent.path}/${folderName}`
      if (buildFolderPathIndex(parent.records).has(targetPath)) {
        throw new CliError(`Folder already exists: ${targetPath}`, {
          code: 'INVALID_FOLDER_PATH',
        })
      }

      const response = await client.requestJson<RelayApiFolderCreateResponse>({
        method: 'POST',
        path: `/api/workspaces/${workspace.id}/folders`,
        accessToken,
        body: {
          name: folderName,
          ...(parent.folderId ? { parentId: parent.folderId } : {}),
        },
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data.folder)
        return
      }

      runtime.output.writeLine(`Created folder ${targetPath}`)
    })

  folder
    .command('rename <path>')
    .description('Rename a folder')
    .requiredOption('--name <new-name>', 'New name for the folder')
    .option('--workspace <workspace-id|name>', 'Workspace to modify instead of the local default')
    .action(async (folderPath: string, options: FolderRenameOptions, command: Command) => {
      const newName = validateFolderName(options.name)
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      const resolved = await resolveFolderPath({
        client,
        accessToken,
        workspaceId: workspace.id,
        folderPath,
      })

      const response = await client.requestJson<RelayApiFolderUpdateResponse>({
        method: 'PATCH',
        path: `/api/folders/${resolved.folderId}`,
        accessToken,
        body: { name: newName },
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data.folder)
        return
      }

      runtime.output.writeLine(`Renamed folder to ${response.data.folder.name}`)
    })

  folder
    .command('move <path>')
    .description('Move a folder to another parent folder')
    .requiredOption('--parent <path>', 'New parent folder path (use / for root)')
    .option('--workspace <workspace-id|name>', 'Workspace to modify instead of the local default')
    .action(async (folderPath: string, options: FolderMoveOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      const source = await resolveFolderPath({
        client,
        accessToken,
        workspaceId: workspace.id,
        folderPath,
      })
      if (source.folderPath === '/') {
        throw new CliError('Cannot move the root folder', { code: 'INVALID_FOLDER_PATH' })
      }

      const dest = await resolveFolderPath({
        client,
        accessToken,
        workspaceId: workspace.id,
        folderPath: options.parent,
      })
      if (dest.folderPath === source.folderPath || dest.folderPath.startsWith(`${source.folderPath}/`)) {
        throw new CliError('Cannot move a folder into itself or one of its sub-folders', {
          code: 'INVALID_FOLDER_PATH',
        })
      }

      const response = await client.requestJson<RelayApiFolderUpdateResponse>({
        method: 'PATCH',
        path: `/api/folders/${source.folderId}`,
        accessToken,
        body: { parentId: dest.folderId },
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data.folder)
        return
      }

      const newPath = dest.folderPath === '/' ? `/${response.data.folder.name}` : `${dest.folderPath}/${response.data.folder.name}`
      runtime.output.writeLine(`Moved folder to ${newPath}`)
    })

  const deleteCommand = folder
    .command('delete <path>')
    .alias('rm')
    .description('Delete a folder and all of its sub-folders')
    .option('--yes', 'Skip the confirmation prompt')
    .option('--workspace <workspace-id|name>', 'Workspace to modify instead of the local default')
    .action(async (folderPath: string, options: FolderDeleteOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      const resolved = await resolveFolderPath({
        client,
        accessToken,
        workspaceId: workspace.id,
        folderPath,
      })
      if (resolved.folderPath === '/') {
        throw new CliError('Cannot delete the root folder', { code: 'INVALID_FOLDER_PATH' })
      }

      if (!options.yes) {
        const accepted = await confirm(
          `Delete folder ${resolved.folderPath} and all of its sub-folders? This cannot be undone`,
          false,
        )
        if (!accepted) {
          if (runtime.options.json) {
            runtime.output.writeJson({ success: false, cancelled: true })
          } else {
            runtime.output.warn('Folder deletion cancelled.')
          }
          return
        }
      }

      await client.requestJson<RelayApiSuccessResponse>({
        method: 'DELETE',
        path: `/api/folders/${resolved.folderId}`,
        accessToken,
      })

      if (runtime.options.json) {
        runtime.output.writeJson({ success: true, folderId: resolved.folderId, folderPath: resolved.folderPath })
        return
      }

      runtime.output.writeLine(`Deleted folder ${resolved.folderPath}`)
    })

  deleteCommand.alias('remove')

  return folder
}

async function resolveParentFolder(
  client: RelayHttpClient,
  accessToken: string,
  workspaceId: string,
  parentPath: string,
) {
  const resolved = await resolveFolderPath({
    client,
    accessToken,
    workspaceId,
    folderPath: parentPath,
  })

  return {
    folderId: resolved.folderId,
    path: resolved.folderPath,
    records: resolved.records,
  }
}

function validateFolderName(rawName: string) {
  const name = rawName.trim()
  if (!name) {
    throw new CliError('Folder name cannot be empty', { code: 'INVALID_FOLDER_PATH' })
  }
  if (name.length > 64) {
    throw new CliError('Folder name must be at most 64 characters', { code: 'INVALID_FOLDER_PATH' })
  }
  if (name === '.' || name === '..') {
    throw new CliError('Folder name cannot be . or ..', { code: 'INVALID_FOLDER_PATH' })
  }
  if (/[/\\<>:"'|?*]/.test(name)) {
    throw new CliError('Folder name contains invalid characters', { code: 'INVALID_FOLDER_PATH' })
  }

  return name
}
