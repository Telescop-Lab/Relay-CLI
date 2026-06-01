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

export interface RelayApiAuthMeResponse {
  user: RelayApiUser
  device: RelayApiDevice
}

export interface RelayApiAuthSessionResponse {
  status?: 'OK'
  token: string
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