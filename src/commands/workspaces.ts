import fs from 'node:fs/promises'

import { Command } from 'commander'

import type { WorkspaceRecord } from '../domain/workspace.js'
import { editTextInEditor } from '../lib/editor.js'
import { CliError, isCliError } from '../lib/errors.js'
import { resolveCliPath } from '../lib/files.js'
import { confirm, readStdin } from '../lib/prompts.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { fetchWorkspaces, resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type {
  RelayApiSuccessResponse,
  RelayApiWorkspaceMessage,
  RelayApiWorkspaceMessageResponse,
  RelayApiWorkspaceResponse,
  RelayApiWorkspaceUpdateResponse,
} from '../transport/types.js'

type WorkspaceListOptions = {
  workspace?: string
}

type WorkspaceCreateOptions = {
  desc?: string
  use?: boolean
}

type WorkspaceDeleteOptions = {
  confirmName: string
  yes?: boolean
}

type WorkspaceMessageOptions = {
  workspace?: string
}

type WorkspaceMessageSetOptions = WorkspaceMessageOptions & {
  file?: string
  stdin?: boolean
  force?: boolean
}

type WorkspaceRenameOptions = {
  name?: string
  desc?: string
}

export function createWorkspaceCommand() {
  const ws = new Command('ws')
    .description('Manage workspaces')

  const message = ws
    .command('message')
    .description('Read and update workspace_message content')

  ws
    .command('list')
    .description('List all workspaces on the current account')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspaces = await fetchWorkspaces(client, accessToken)
      const defaultWorkspace = runtime.config.getDefaultWorkspace()

      if (runtime.options.json) {
        runtime.output.writeJson(
          workspaces.map((workspace) => ({
            ...workspace,
            isDefault: matchesDefaultWorkspace(workspace, defaultWorkspace),
          })),
        )
        return
      }

      runtime.output.writeTable(
        workspaces.map((workspace) => ({
          current: matchesDefaultWorkspace(workspace, defaultWorkspace) ? '*' : '',
          name: workspace.name,
          id: workspace.id,
          usedBytes: workspace.usedBytes,
          bundleCount: workspace.bundleCount,
          updatedAt: workspace.updatedAt,
        })),
      )
    })

  ws
    .command('use <workspace-id-or-name>')
    .description('Set the local default workspace')
    .action(async (workspaceReference: string, _options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: workspaceReference,
        config: runtime.config,
        client,
        accessToken,
      })

      runtime.config.setDefaultWorkspace(workspace.id)

      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace,
          defaultWorkspace: workspace.id,
        })
        return
      }

      runtime.output.writeLine(`Default workspace set to ${workspace.name} (${workspace.id})`)
    })

  ws
    .command('create <name>')
    .description('Create a new workspace')
    .option('--desc <text>', 'Workspace description')
    .option('--use', 'Set the new workspace as the local default')
    .action(async (name: string, options: WorkspaceCreateOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const response = await client.requestJson<RelayApiWorkspaceResponse>({
        method: 'POST',
        path: '/api/workspaces',
        accessToken,
        body: {
          name,
          ...(options.desc ? { description: options.desc } : {}),
        },
      })

      if (options.use) {
        runtime.config.setDefaultWorkspace(response.data.workspace.id)
      }

      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace: response.data.workspace,
          defaultWorkspace: options.use ? response.data.workspace.id : runtime.config.getDefaultWorkspace(),
        })
        return
      }

      runtime.output.writeLine(`Created workspace ${response.data.workspace.name} (${response.data.workspace.id})`)
      if (options.use) {
        runtime.output.writeLine(`Default workspace set to ${response.data.workspace.id}`)
      }
    })

  ws
    .command('info [workspace-id-or-name]')
    .description('Show workspace details')
    .action(async (workspaceReference: string | undefined, _options: WorkspaceListOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: workspaceReference,
        config: runtime.config,
        client,
        accessToken,
      })
      const response = await client.requestJson<RelayApiWorkspaceResponse>({
        path: `/api/workspaces/${workspace.id}`,
        accessToken,
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data.workspace)
        return
      }

      runtime.output.writeLine(`name: ${response.data.workspace.name}`)
      runtime.output.writeLine(`description: ${response.data.workspace.description ?? ''}`)
      runtime.output.writeLine(`usedBytes: ${response.data.workspace.usedBytes}`)
      runtime.output.writeLine(`bundleCount: ${response.data.workspace.bundleCount}`)
      runtime.output.writeLine(`deviceCount: ${response.data.workspace.deviceCount}`)
      runtime.output.writeLine(`updatedAt: ${response.data.workspace.updatedAt}`)
    })

  const deleteCommand = ws
    .command('delete <workspace-id-or-name>')
    .alias('rm')
    .description('Delete a workspace and all of its bundles, files, and metadata')
    .requiredOption('--confirm-name <workspace-name>', 'Workspace name confirmation required by the server')
    .option('--yes', 'Skip the local confirmation prompt')
    .action(async (workspaceReference: string, options: WorkspaceDeleteOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: workspaceReference,
        config: runtime.config,
        client,
        accessToken,
      })

      if (options.confirmName !== workspace.name) {
        throw new CliError('Confirmation name must match the target workspace name exactly', {
          hint: `Retry with --confirm-name ${workspace.name}`,
        })
      }

      if (!options.yes) {
        const accepted = await confirm(`Delete workspace ${workspace.name}? This cannot be undone`, false)
        if (!accepted) {
          if (runtime.options.json) {
            runtime.output.writeJson({ success: false, cancelled: true })
          } else {
            runtime.output.warn('Workspace deletion cancelled.')
          }
          return
        }
      }

      await client.requestJson<RelayApiSuccessResponse>({
        method: 'DELETE',
        path: `/api/workspaces/${workspace.id}`,
        accessToken,
        body: {
          confirm: options.confirmName,
        },
      })

      if (matchesDefaultWorkspace(workspace, runtime.config.getDefaultWorkspace())) {
        runtime.config.setDefaultWorkspace(null)
      }

      if (runtime.options.json) {
        runtime.output.writeJson({ success: true, workspaceId: workspace.id, workspaceName: workspace.name })
        return
      }

      runtime.output.writeLine(`Deleted workspace ${workspace.name} (${workspace.id})`)
    })

  deleteCommand.alias('remove')

  message
    .command('show')
    .description('Show the current workspace_message content')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .action(async (options: WorkspaceMessageOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const response = await client.requestJson<RelayApiWorkspaceMessageResponse>({
        path: `/api/workspaces/${workspace.id}/message`,
        accessToken,
      })
      const workspaceMessage = unwrapWorkspaceMessage(response.data)

      if (runtime.options.json) {
        runtime.output.writeJson({ workspace, workspaceMessage })
        return
      }

      if (workspaceMessage.content.length > 0) {
        process.stdout.write(workspaceMessage.content)
      }
      if (!workspaceMessage.content.endsWith('\n')) {
        runtime.output.writeLine()
      }
    })

  message
    .command('set')
    .description('Update workspace_message content')
    .option('--workspace <workspace-id|name>', 'Workspace to update instead of the local default')
    .option('--file <path>', 'Read message content from a local file')
    .option('--stdin', 'Read message content from standard input')
    .option('--force', 'Override optimistic locking if the message changed remotely')
    .action(async (options: WorkspaceMessageSetOptions, command: Command) => {
      if (options.file && options.stdin) {
        throw new CliError('Use either --file or --stdin, not both')
      }

      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const currentResponse = await client.requestJson<RelayApiWorkspaceMessageResponse>({
        path: `/api/workspaces/${workspace.id}/message`,
        accessToken,
      })
      const currentMessage = unwrapWorkspaceMessage(currentResponse.data)
      const content = await readWorkspaceMessageContent(runtime.cwd, currentMessage, options)

      try {
        const response = await client.requestJson<RelayApiWorkspaceMessageResponse>({
          method: 'PUT',
          path: `/api/workspaces/${workspace.id}/message`,
          accessToken,
          body: {
            content,
            version: currentMessage.version,
            force: Boolean(options.force),
          },
        })
        const workspaceMessage = unwrapWorkspaceMessage(response.data)

        if (runtime.options.json) {
          runtime.output.writeJson({ workspace, workspaceMessage })
          return
        }

        runtime.output.writeLine(`Updated workspace_message for ${workspace.name} (version ${workspaceMessage.version})`)
      } catch (error) {
        if (isCliError(error) && error.status === 409 && isWorkspaceMessageConflict(error.details)) {
          throw new CliError('Workspace message conflict', {
            code: 'WORKSPACE_MESSAGE_CONFLICT',
            details: error.details,
            hint: 'Re-run with --force to overwrite the latest remote version.',
          })
        }

        throw error
      }
    })

  ws
    .command('rename <workspace-id-or-name>')
    .alias('edit')
    .description('Rename a workspace or update its description')
    .option('--name <new-name>', 'New workspace name')
    .option('--desc <text>', 'New workspace description')
    .action(async (workspaceReference: string, options: WorkspaceRenameOptions, command: Command) => {
      if (options.name === undefined && options.desc === undefined) {
        throw new CliError('Provide --name, --desc, or both')
      }

      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: workspaceReference,
        config: runtime.config,
        client,
        accessToken,
      })

      const response = await client.requestJson<RelayApiWorkspaceUpdateResponse>({
        method: 'PATCH',
        path: `/api/workspaces/${workspace.id}`,
        accessToken,
        body: {
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.desc !== undefined ? { description: options.desc } : {}),
        },
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data)
        return
      }

      const updated = response.data.workspace
      const changed: string[] = []
      if (options.name !== undefined) changed.push(`name → ${updated.name}`)
      if (options.desc !== undefined) changed.push(`description → ${updated.description ?? ''}`)
      runtime.output.writeLine(`Updated workspace ${updated.name} (${updated.id}): ${changed.join('; ')}`)
    })

  return ws
}

function matchesDefaultWorkspace(workspace: WorkspaceRecord, defaultWorkspace: string | null) {
  return Boolean(defaultWorkspace && (workspace.id === defaultWorkspace || workspace.name === defaultWorkspace))
}

async function readWorkspaceMessageContent(
  cwd: string,
  currentMessage: RelayApiWorkspaceMessage,
  options: WorkspaceMessageSetOptions,
) {
  if (options.file) {
    const filePath = resolveCliPath(options.file, cwd)
    return await fs.readFile(filePath, 'utf8')
  }

  if (options.stdin) {
    return await readStdin()
  }

  return await editTextInEditor(currentMessage.content)
}

function unwrapWorkspaceMessage(response: RelayApiWorkspaceMessageResponse): RelayApiWorkspaceMessage {
  return response.workspace_message ?? response.workspaceMessage ?? response.note ?? {
    content: '',
    version: 0,
    updatedByDeviceName: null,
    updatedAt: null,
  }
}

function isWorkspaceMessageConflict(details: unknown) {
  return Boolean(
    details &&
      typeof details === 'object' &&
      'code' in details &&
      details.code === 'WORKSPACE_MESSAGE_CONFLICT',
  )
}