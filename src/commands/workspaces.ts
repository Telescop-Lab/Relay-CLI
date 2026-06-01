import { Command } from 'commander'

import type { WorkspaceRecord } from '../domain/workspace.js'
import { CliError } from '../lib/errors.js'
import { confirm } from '../lib/prompts.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { fetchWorkspaces, resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import type { RelayApiSuccessResponse, RelayApiWorkspaceResponse } from '../transport/types.js'

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

export function createWorkspaceCommand() {
  const ws = new Command('ws')
    .description('Manage workspaces')

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

  return ws
}

function matchesDefaultWorkspace(workspace: WorkspaceRecord, defaultWorkspace: string | null) {
  return Boolean(defaultWorkspace && (workspace.id === defaultWorkspace || workspace.name === defaultWorkspace))
}