import type { WorkspaceRecord } from '../domain/workspace.js'

export interface RelayApiUser {
  id: string
  username: string
  email: string | null
  createdAt: string
}

export interface RelayApiDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  hasBinding?: boolean
  bindingLastUsedAt?: string | null
  isCurrent?: boolean
}

export interface RelayApiWorkspacesResponse {
  workspaces: WorkspaceRecord[]
}

export interface RelayApiWorkspaceResponse {
  workspace: WorkspaceRecord
}

export interface RelayApiBundleFile {
  id: string
  name: string
  relativePath: string | null
  mimeType: string
  sizeBytes: number
  storageKey?: string
  uploadedAt: string
  uploadUrl?: string
  downloadUrl?: string
}

export interface RelayApiBundle {
  id: string
  bundleId?: string
  bundle_id?: string
  note: string | null
  status: 'STAGING' | 'UPLOADING' | 'READY' | 'FAILED'
  sizeBytes: number
  createdAt: string
  finalizedAt: string | null
  deletedAt: string | null
  workspaceId: string
  folderId: string | null
  folderName: string | null
  deviceId: string
  deviceName: string
  filesCount: number
  files?: RelayApiBundleFile[]
}

export interface RelayApiBundlesResponse {
  bundles: RelayApiBundle[]
  nextCursor: string | null
}

export interface RelayApiBundleResponse {
  bundle: RelayApiBundle
}

export interface RelayApiBundleDownloadFile {
  id: string
  name: string
  relativePath: string | null
  mimeType: string
  sizeBytes: number
  downloadUrl: string
}

export interface RelayApiBundleDownloadUrlsResponse {
  files: RelayApiBundleDownloadFile[]
}

export interface RelayApiAuthMeResponse {
  user: RelayApiUser
  device: RelayApiDevice
}

export interface RelayApiAuthSessionResponse {
  status?: 'OK'
  token: string
  refreshToken?: string
  user: RelayApiUser
  device: RelayApiDevice
}

export interface RelayApiLoginDeviceRequiredResponse {
  status: 'DEVICE_NAME_REQUIRED'
  loginTicket: string
  recentDeviceNames: string[]
}

export type RelayApiLoginResponse =
  | RelayApiAuthSessionResponse
  | RelayApiLoginDeviceRequiredResponse

export interface RelayApiDevicesResponse {
  devices: RelayApiDevice[]
}

export interface RelayApiWorkspaceMessage {
  content: string
  version: number
  updatedByDeviceName: string | null
  updatedAt: string | null
}

export interface RelayApiWorkspaceMessageResponse {
  note?: RelayApiWorkspaceMessage
  workspaceMessage?: RelayApiWorkspaceMessage
  workspace_message?: RelayApiWorkspaceMessage
}

export interface RelayApiHistoryEvent {
  id: string
  type: string
  rawType?: string
  category: 'bundle' | 'workspace'
  actorName: string
  createdAt: string
  bundleId: string | null
  bundle_id?: string | null
  payload: Record<string, unknown> | null
}

export interface RelayApiHistoryResponse {
  events: RelayApiHistoryEvent[]
}

export interface RelayApiStorageStatsResponse {
  usedBytes: number
  quotaBytes: number
  percentage: number
  workspaces: Array<{
    id: string
    name: string
    usedBytes: number
  }>
}

export type RelayApiExportSnapshot = Record<string, unknown> & {
  formatVersion?: number
  exportedAt?: string
}

export interface RelayApiFolderNode {
  id: string
  name: string
  parentId: string | null
  bundleCount: number
  children: RelayApiFolderNode[]
}

export interface RelayApiFoldersResponse {
  folders: RelayApiFolderNode[]
}

export interface RelayApiFolderCreateResponse {
  folder: RelayApiFolderNode
}

export interface RelayApiSuccessResponse {
  success: boolean
}

export interface RelayApiForgetDeviceResponse extends RelayApiSuccessResponse {
  device: RelayApiDevice
}

export interface RelayApiErrorBody {
  error?: string
  message?: string
  code?: string
  [key: string]: unknown
}