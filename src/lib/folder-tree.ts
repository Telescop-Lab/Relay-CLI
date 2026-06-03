import type { RelayHttpClient } from '../transport/http-client.js'
import type {
  RelayApiFolderCreateResponse,
  RelayApiFolderNode,
  RelayApiFoldersResponse,
} from '../transport/types.js'
import { CliError, isCliError } from './errors.js'
import { normalizeFolderPath } from './folder-path.js'

export interface FolderPathRecord {
  id: string
  name: string
  parentId: string | null
  bundleCount: number
  path: string
  parentPath: string | null
}

export async function fetchFolderTree(client: RelayHttpClient, accessToken: string, workspaceId: string) {
  const response = await client.requestJson<RelayApiFoldersResponse>({
    path: `/api/workspaces/${workspaceId}/folders`,
    accessToken,
  })

  return response.data.folders
}

export function flattenFolderTree(folders: RelayApiFolderNode[], parentPath = '/'): FolderPathRecord[] {
  const records: FolderPathRecord[] = []

  for (const folder of folders) {
    const path = joinFolderPath(parentPath, folder.name)
    records.push({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      bundleCount: folder.bundleCount,
      path,
      parentPath: parentPath === '/' ? null : parentPath,
    })
    records.push(...flattenFolderTree(folder.children, path))
  }

  return records.sort((left, right) => left.path.localeCompare(right.path))
}

export function buildFolderPathIndex(records: FolderPathRecord[]) {
  return new Map(records.map((record) => [record.path, record]))
}

export function renderFolderTreeLines(folders: RelayApiFolderNode[], prefix = ''): string[] {
  const lines: string[] = []

  folders.forEach((folder, index) => {
    const isLast = index === folders.length - 1
    const connector = isLast ? '└─' : '├─'
    lines.push(`${prefix}${connector} ${folder.name} (${folder.bundleCount})`)
    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`
    lines.push(...renderFolderTreeLines(folder.children, childPrefix))
  })

  return lines
}

export async function resolveFolderPath(options: {
  client: RelayHttpClient
  accessToken: string
  workspaceId: string
  folderPath?: string | null
}) {
  const folders = await fetchFolderTree(options.client, options.accessToken, options.workspaceId)
  const records = flattenFolderTree(folders)

  if (!options.folderPath) {
    return {
      folderId: null,
      folderPath: '/',
      folders,
      records,
      created: false,
    }
  }

  const normalizedFolderPath = normalizeFolderPath(options.folderPath)
  if (normalizedFolderPath === '/') {
    return {
      folderId: null,
      folderPath: normalizedFolderPath,
      folders,
      records,
      created: false,
    }
  }

  const folder = buildFolderPathIndex(records).get(normalizedFolderPath)
  if (!folder) {
    throw new CliError(`Folder path not found: ${normalizedFolderPath}`, {
      code: 'INVALID_FOLDER_PATH',
      hint: 'Run relay folder list to inspect valid folder paths.',
    })
  }

  return {
    folderId: folder.id,
    folderPath: normalizedFolderPath,
    folders,
    records,
    created: false,
  }
}

export async function ensureFolderPath(options: {
  client: RelayHttpClient
  accessToken: string
  workspaceId: string
  folderPath: string
}) {
  const normalizedFolderPath = normalizeFolderPath(options.folderPath)
  const folders = await fetchFolderTree(options.client, options.accessToken, options.workspaceId)
  let records = flattenFolderTree(folders)
  const segments = normalizedFolderPath === '/' ? [] : normalizedFolderPath.slice(1).split('/')
  let currentPath = '/'
  let currentParentId: string | null = null
  let created = false

  for (const segment of segments) {
    const nextPath = joinFolderPath(currentPath, segment)
    const existing = buildFolderPathIndex(records).get(nextPath)
    if (existing) {
      currentPath = nextPath
      currentParentId = existing.id
      continue
    }

    try {
      const previousPath = currentPath
      const createFolderResponse: { data: RelayApiFolderCreateResponse } = await options.client.requestJson<RelayApiFolderCreateResponse>({
        method: 'POST',
        path: `/api/workspaces/${options.workspaceId}/folders`,
        accessToken: options.accessToken,
        body: {
          name: segment,
          ...(currentParentId ? { parentId: currentParentId } : {}),
        },
      })

      const createdFolder: RelayApiFolderCreateResponse['folder'] = createFolderResponse.data.folder
      currentPath = nextPath
      currentParentId = createdFolder.id
      created = true
      records = [
        ...records,
        {
          id: createdFolder.id,
          name: createdFolder.name,
          parentId: createdFolder.parentId,
          bundleCount: createdFolder.bundleCount,
          path: nextPath,
          parentPath: previousPath === '/' ? null : previousPath,
        },
      ]
    } catch (error) {
      if (isCliError(error) && error.status === 409) {
        const refreshedFolders = await fetchFolderTree(options.client, options.accessToken, options.workspaceId)
        records = flattenFolderTree(refreshedFolders)
        const concurrentFolder = buildFolderPathIndex(records).get(nextPath)
        if (concurrentFolder) {
          currentPath = nextPath
          currentParentId = concurrentFolder.id
          continue
        }
      }

      throw error
    }
  }

  return {
    folderId: currentParentId,
    folderPath: normalizedFolderPath,
    folders,
    records,
    created,
  }
}

function joinFolderPath(parentPath: string, name: string) {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
}