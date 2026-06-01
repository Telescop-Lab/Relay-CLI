import type { ConfigStore } from './config-store.js'
import { CliError } from './errors.js'
import type { RelayHttpClient } from '../transport/http-client.js'
import type { RelayApiWorkspacesResponse } from '../transport/types.js'
import type { ResolvedWorkspace, WorkspaceRecord } from '../domain/workspace.js'

type ResolveWorkspaceOptions = {
  explicitReference?: string | null
  config: ConfigStore
  client: RelayHttpClient
  accessToken: string
}

export async function resolveWorkspaceReference(options: ResolveWorkspaceOptions) {
  const reference = options.explicitReference?.trim() || options.config.getDefaultWorkspace()
  if (!reference) {
    throw new CliError('No workspace selected', {
      code: 'WORKSPACE_REQUIRED',
      hint: 'Use --workspace <workspace-id|name>, or set a default with relay ws use <workspace>.',
    })
  }

  const workspaces = await fetchWorkspaces(options.client, options.accessToken)

  return matchWorkspaceReference(workspaces, reference, {
    matchedBy: options.explicitReference ? 'id' : 'default',
  })
}

export async function fetchWorkspaces(client: RelayHttpClient, accessToken: string) {
  const response = await client.requestJson<RelayApiWorkspacesResponse>({
    path: '/api/workspaces',
    accessToken,
  })

  return response.data.workspaces
}

export function matchWorkspaceReference(
  workspaces: WorkspaceRecord[],
  reference: string,
  context: { matchedBy: 'default' | 'id' | 'name' },
): ResolvedWorkspace {
  const byId = workspaces.find((workspace) => workspace.id === reference)
  if (byId) {
    return {
      ...byId,
      reference,
      matchedBy: context.matchedBy === 'default' ? 'default' : 'id',
    }
  }

  const byName = workspaces.filter((workspace) => workspace.name === reference)
  if (byName.length === 1) {
    return {
      ...byName[0],
      reference,
      matchedBy: context.matchedBy === 'default' ? 'default' : 'name',
    }
  }

  if (byName.length > 1) {
    throw new CliError(`Workspace name is ambiguous: ${reference}`, {
      code: 'WORKSPACE_AMBIGUOUS',
      hint: 'Retry with the exact workspace id instead of the name.',
      details: byName.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    })
  }

  throw new CliError(`Workspace not found: ${reference}`, {
    code: 'WORKSPACE_NOT_FOUND',
    hint: 'Check relay ws list and retry with an exact id or unique name.',
  })
}