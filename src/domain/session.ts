export interface SessionSummary {
  profile: string
  serviceUrl: string
  updatedAt: string
  userId: string | null
  username: string | null
  email: string | null
  deviceId: string | null
  deviceName: string | null
  hasBinding: boolean
}

export interface StoredBindingRecord {
  userId: string
  deviceId: string
  deviceName: string
  updatedAt: string
  secret?: string | null
}

export interface StoredServiceCredentials {
  serviceUrl: string
  accessToken?: string | null
  refreshToken?: string | null
  bindings: StoredBindingRecord[]
}

export interface RelayCredentialState {
  version: 2
  currentProfile: string | null
  profiles: Record<string, StoredServiceCredentials>
  summaries: Record<string, SessionSummary>
}

export interface CredentialSnapshot {
  backend: 'keychain' | 'state-file'
  profile: string
  serviceUrl: string | null
  hasAccessToken: boolean
  bindingCount: number
  summary: SessionSummary | null
}