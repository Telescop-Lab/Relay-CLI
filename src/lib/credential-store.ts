import Conf from 'conf'

import type {
  RelayCredentialState,
  SessionSummary,
  StoredBindingRecord,
  StoredServiceCredentials,
} from '../domain/session.js'
import {
  DEFAULT_PROFILE,
  RELAY_DISABLE_KEYCHAIN_ENV,
  RELAY_HOME,
} from './constants.js'
import { normalizeProfileName } from './config-store.js'

type BindingLookup = {
  profile: string
  userId?: string | null
  deviceId?: string | null
}

type BindingWrite = {
  profile: string
  userId: string
  deviceId: string
  deviceName: string
  secret: string
}

type SecretBackend = {
  get: (service: string, account: string) => Promise<string | null>
  set: (service: string, account: string, secret: string) => Promise<boolean>
  delete: (service: string, account: string) => Promise<void>
}

export class CredentialStore {
  private readonly store = new Conf<RelayCredentialState>({
    cwd: RELAY_HOME,
    configName: 'state',
    projectName: 'relay',
    defaults: {
      version: 2,
      currentProfile: null,
      profiles: {},
      summaries: {},
    },
  })

  private keychainPromise?: Promise<SecretBackend | null>

  constructor() {
    this.migrateLegacyState()
  }

  async getAccessToken(profile: string) {
    const profileKey = normalizeProfileName(profile)
    const backend = await this.getKeychainBackend()
    if (backend) {
      const secret = await backend.get('relay-cli:access-token', profileKey)
      if (secret) {
        return secret
      }
    }

    return this.getProfileRecord(profileKey).accessToken ?? null
  }

  async setAccessToken(profile: string, accessToken: string | null) {
    const profileKey = normalizeProfileName(profile)
    const backend = await this.getKeychainBackend()
    const profiles = this.store.get('profiles')
    const record = cloneProfileRecord(profiles[profileKey])

    if (accessToken) {
      const storedInKeychain = backend
        ? await backend.set('relay-cli:access-token', profileKey, accessToken)
        : false
      if (storedInKeychain) {
        delete record.accessToken
      } else {
        record.accessToken = accessToken
      }
    } else {
      if (backend) {
        await backend.delete('relay-cli:access-token', profileKey)
      }
      delete record.accessToken
    }

    profiles[profileKey] = record
    this.store.set('profiles', profiles)
    this.store.set('currentProfile', profileKey)
  }

  async getRefreshToken(profile: string) {
    const profileKey = normalizeProfileName(profile)
    const backend = await this.getKeychainBackend()
    if (backend) {
      const secret = await backend.get('relay-cli:refresh-token', profileKey)
      if (secret) {
        return secret
      }
    }

    return this.getProfileRecord(profileKey).refreshToken ?? null
  }

  async setRefreshToken(profile: string, refreshToken: string | null) {
    const profileKey = normalizeProfileName(profile)
    const backend = await this.getKeychainBackend()
    const profiles = this.store.get('profiles')
    const record = cloneProfileRecord(profiles[profileKey])

    if (refreshToken) {
      const storedInKeychain = backend
        ? await backend.set('relay-cli:refresh-token', profileKey, refreshToken)
        : false
      if (storedInKeychain) {
        delete record.refreshToken
      } else {
        record.refreshToken = refreshToken
      }
    } else {
      if (backend) {
        await backend.delete('relay-cli:refresh-token', profileKey)
      }
      delete record.refreshToken
    }

    profiles[profileKey] = record
    this.store.set('profiles', profiles)
  }

  async setServiceUrl(profile: string, serviceUrl: string) {
    const profileKey = normalizeProfileName(profile)
    const profiles = this.store.get('profiles')
    const record = cloneProfileRecord(profiles[profileKey])
    record.serviceUrl = serviceUrl
    profiles[profileKey] = record
    this.store.set('profiles', profiles)
  }

  async getDeviceBinding(criteria: BindingLookup) {
    const profileKey = normalizeProfileName(criteria.profile)
    const record = this.getProfileRecord(profileKey)
    const candidates = record.bindings.filter((binding) => {
      if (criteria.userId && binding.userId !== criteria.userId) {
        return false
      }
      if (criteria.deviceId && binding.deviceId !== criteria.deviceId) {
        return false
      }

      return true
    })

    const selected = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    if (!selected) {
      return null
    }

    const backend = await this.getKeychainBackend()
    if (backend) {
      const secret = await backend.get('relay-cli:device-binding', bindingAccount(profileKey, selected))
      if (secret) {
        return secret
      }
    }

    return selected.secret ?? null
  }

  async setDeviceBinding(binding: BindingWrite) {
    const profileKey = normalizeProfileName(binding.profile)
    const profiles = this.store.get('profiles')
    const record = cloneProfileRecord(profiles[profileKey])
    const backend = await this.getKeychainBackend()
    const nextBinding: StoredBindingRecord = {
      userId: binding.userId,
      deviceId: binding.deviceId,
      deviceName: binding.deviceName,
      updatedAt: new Date().toISOString(),
    }

    const storedInKeychain = backend
      ? await backend.set(
          'relay-cli:device-binding',
          bindingAccount(profileKey, nextBinding),
          binding.secret,
        )
      : false

    if (!storedInKeychain) {
      nextBinding.secret = binding.secret
    }

    record.bindings = record.bindings.filter(
      (item) => !(item.userId === binding.userId && item.deviceId === binding.deviceId),
    )
    record.bindings.unshift(nextBinding)

    profiles[profileKey] = record
    this.store.set('profiles', profiles)
    this.store.set('currentProfile', profileKey)
  }

  async clearDeviceBinding(criteria: BindingLookup) {
    const profileKey = normalizeProfileName(criteria.profile)
    const profiles = this.store.get('profiles')
    const record = cloneProfileRecord(profiles[profileKey])
    const backend = await this.getKeychainBackend()
    const toRemove = record.bindings.filter((binding) => {
      if (criteria.userId && binding.userId !== criteria.userId) {
        return false
      }
      if (criteria.deviceId && binding.deviceId !== criteria.deviceId) {
        return false
      }

      return true
    })

    if (backend) {
      await Promise.all(
        toRemove.map((binding) =>
          backend.delete('relay-cli:device-binding', bindingAccount(profileKey, binding)),
        ),
      )
    }

    record.bindings = record.bindings.filter((binding) => !toRemove.includes(binding))
    profiles[profileKey] = record
    this.store.set('profiles', profiles)
  }

  getSessionSummary(profile: string) {
    const profileKey = normalizeProfileName(profile)
    const summaries = this.store.get('summaries')
    return summaries[profileKey] ?? null
  }

  setSessionSummary(summary: SessionSummary | null) {
    if (!summary) {
      return
    }

    const profileKey = normalizeProfileName(summary.profile)
    const summaries = this.store.get('summaries')
    summaries[profileKey] = {
      ...summary,
      profile: profileKey,
    }
    this.store.set('summaries', summaries)
    this.store.set('currentProfile', profileKey)
  }

  private getProfileRecord(profileKey: string) {
    const profiles = this.store.get('profiles')
    return cloneProfileRecord(profiles[profileKey])
  }

  private async getKeychainBackend() {
    if (!this.keychainPromise) {
      this.keychainPromise = loadKeychainBackend()
    }

    return this.keychainPromise
  }

  private migrateLegacyState() {
    const raw = this.store.store as unknown as {
      version?: number
      currentServiceUrl?: string | null
      services?: Record<string, StoredServiceCredentials>
      currentProfile?: string | null
      profiles?: Record<string, StoredServiceCredentials>
      summaries?: Record<string, SessionSummary>
    }

    if (raw.version === 2 || !raw.services) {
      return
    }

    const profiles = raw.profiles ?? {}
    const summaries = raw.summaries ?? {}
    const legacyUrl = raw.currentServiceUrl ?? Object.keys(raw.services)[0]

    if (legacyUrl) {
      const legacy = raw.services[legacyUrl]
      if (legacy) {
        profiles[DEFAULT_PROFILE] = {
          serviceUrl: legacyUrl,
          accessToken: legacy.accessToken,
          refreshToken: legacy.refreshToken,
          bindings: [...(legacy.bindings ?? [])],
        }
      }
    }

    // Migrate summaries keyed by service URL to keyed by profile (default only,
    // since the legacy model held exactly one active service).
    for (const [key, summary] of Object.entries(raw.summaries ?? {})) {
      if (key === legacyUrl && summary) {
        summaries[DEFAULT_PROFILE] = { ...summary, profile: DEFAULT_PROFILE }
      }
    }

    this.store.set('version', 2)
    this.store.set('currentProfile', DEFAULT_PROFILE)
    this.store.set('profiles', profiles)
    this.store.set('summaries', summaries)
    this.store.delete('services' as never)
    this.store.delete('currentServiceUrl' as never)
  }
}

function bindingAccount(profileKey: string, binding: Pick<StoredBindingRecord, 'userId' | 'deviceId'>) {
  return `${profileKey}:${binding.userId}:${binding.deviceId}`
}

function cloneProfileRecord(record?: StoredServiceCredentials): StoredServiceCredentials {
  return {
    serviceUrl: record?.serviceUrl ?? '',
    accessToken: record?.accessToken ?? null,
    refreshToken: record?.refreshToken ?? null,
    bindings: [...(record?.bindings ?? [])],
  }
}

async function loadKeychainBackend(): Promise<SecretBackend | null> {
  const disableKeychain = process.env[RELAY_DISABLE_KEYCHAIN_ENV]
  if (disableKeychain === '1' || disableKeychain === 'true') {
    return null
  }

  const moduleName = '@napi-rs/keyring'

  try {
    const keyringModule = (await import(moduleName)) as {
      default?: { Entry?: KeyringEntryConstructor }
      Entry?: KeyringEntryConstructor
    }
    const Entry = keyringModule.Entry ?? keyringModule.default?.Entry

    if (!Entry) {
      return null
    }

    return {
      get: async (service, account) => {
        try {
          return new Entry(service, account).getPassword()
        } catch {
          return null
        }
      },
      set: async (service, account, secret) => {
        try {
          new Entry(service, account).setPassword(secret)
          return true
        } catch {
          return false
        }
      },
      delete: async (service, account) => {
        try {
          new Entry(service, account).deletePassword()
        } catch {
          // Non-fatal: the caller clears its plaintext record regardless.
        }
      },
    }
  } catch {
    return null
  }
}

type KeyringEntryConstructor = new (service: string, account: string) => {
  getPassword: () => string | null
  setPassword: (password: string) => void
  deletePassword: () => boolean
}
