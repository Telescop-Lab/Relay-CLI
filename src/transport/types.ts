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

export interface RelayApiAuthMeResponse {
  user: RelayApiUser
  device: RelayApiDevice
}

export interface RelayApiDevicesResponse {
  devices: RelayApiDevice[]
}

export interface RelayApiErrorBody {
  error?: string
  message?: string
  code?: string
  [key: string]: unknown
}