export interface WorkspaceRecord {
  id: string
  name: string
  slug: string
  description: string | null
  usedBytes: number
  createdAt: string
  updatedAt: string
  deviceCount: number
  bundleCount: number
}

export interface ResolvedWorkspace extends WorkspaceRecord {
  reference: string
  matchedBy: 'id' | 'name' | 'default'
}