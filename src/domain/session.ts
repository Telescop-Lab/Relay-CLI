export interface SessionSummary {
  serviceUrl: string
  updatedAt: string
  userId: string | null
  username: string | null
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
  accessToken?: string | null
  bindings: StoredBindingRecord[]
}

export interface RelayCredentialState {
  version: 1
  currentServiceUrl: string | null
  services: Record<string, StoredServiceCredentials>
  summaries: Record<string, SessionSummary>
}

export interface CredentialSnapshot {
  backend: 'keychain' | 'state-file'
  currentServiceUrl: string | null
  hasAccessToken: boolean
  bindingCount: number
  summary: SessionSummary | null
}