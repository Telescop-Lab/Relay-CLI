import Conf from 'conf'

import type {
  CredentialSnapshot,
  RelayCredentialState,
  SessionSummary,
  StoredBindingRecord,
  StoredServiceCredentials,
} from '../domain/session.js'
import { RELAY_HOME, RELAY_TOKEN_ENV } from './constants.js'

type BindingLookup = {
  serviceUrl: string
  userId?: string | null
  deviceId?: string | null
}

type BindingWrite = {
  serviceUrl: string
  userId: string
  deviceId: string
  deviceName: string
  secret: string
}

type SecretBackend = {
  get: (service: string, account: string) => Promise<string | null>
  set: (service: string, account: string, secret: string) => Promise<void>
  delete: (service: string, account: string) => Promise<void>
}

export class CredentialStore {
  private readonly store = new Conf<RelayCredentialState>({
    cwd: RELAY_HOME,
    configName: 'state',
    projectName: 'relay',
    defaults: {
      version: 1,
      currentServiceUrl: null,
      services: {},
      summaries: {},
    },
  })

  private keychainPromise?: Promise<SecretBackend | null>

  async getAccessToken(serviceUrl: string) {
    const envToken = process.env[RELAY_TOKEN_ENV]?.trim()
    if (envToken) {
      return envToken
    }

    const serviceKey = toServiceKey(serviceUrl)
    const backend = await this.getKeychainBackend()
    if (backend) {
      const secret = await backend.get('relay-cli:access-token', serviceKey)
      if (secret) {
        return secret
      }
    }

    return this.getServiceRecord(serviceKey).accessToken ?? null
  }

  async setAccessToken(serviceUrl: string, accessToken: string | null) {
    const serviceKey = toServiceKey(serviceUrl)
    const backend = await this.getKeychainBackend()
    const services = this.store.get('services')
    const record = cloneServiceRecord(services[serviceKey])

    if (accessToken) {
      if (backend) {
        await backend.set('relay-cli:access-token', serviceKey, accessToken)
        delete record.accessToken
      } else {
        record.accessToken = accessToken
      }
    } else {
      if (backend) {
        await backend.delete('relay-cli:access-token', serviceKey)
      }
      delete record.accessToken
    }

    services[serviceKey] = record
    this.store.set('services', services)
    this.store.set('currentServiceUrl', serviceKey)
  }

  async getRefreshToken(serviceUrl: string) {
    const serviceKey = toServiceKey(serviceUrl)
    return this.getServiceRecord(serviceKey).refreshToken ?? null
  }

  async setRefreshToken(serviceUrl: string, refreshToken: string | null) {
    const serviceKey = toServiceKey(serviceUrl)
    const services = this.store.get('services')
    const record = cloneServiceRecord(services[serviceKey])

    if (refreshToken) {
      record.refreshToken = refreshToken
    } else {
      delete record.refreshToken
    }

    services[serviceKey] = record
    this.store.set('services', services)
  }

  async getDeviceBinding(criteria: BindingLookup) {
    const serviceKey = toServiceKey(criteria.serviceUrl)
    const record = this.getServiceRecord(serviceKey)
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
      const secret = await backend.get('relay-cli:device-binding', bindingAccount(serviceKey, selected))
      if (secret) {
        return secret
      }
    }

    return selected.secret ?? null
  }

  async setDeviceBinding(binding: BindingWrite) {
    const serviceKey = toServiceKey(binding.serviceUrl)
    const services = this.store.get('services')
    const record = cloneServiceRecord(services[serviceKey])
    const backend = await this.getKeychainBackend()
    const nextBinding: StoredBindingRecord = {
      userId: binding.userId,
      deviceId: binding.deviceId,
      deviceName: binding.deviceName,
      updatedAt: new Date().toISOString(),
    }

    if (backend) {
      await backend.set(
        'relay-cli:device-binding',
        bindingAccount(serviceKey, nextBinding),
        binding.secret,
      )
    } else {
      nextBinding.secret = binding.secret
    }

    record.bindings = record.bindings.filter(
      (item) => !(item.userId === binding.userId && item.deviceId === binding.deviceId),
    )
    record.bindings.unshift(nextBinding)

    services[serviceKey] = record
    this.store.set('services', services)
    this.store.set('currentServiceUrl', serviceKey)
  }

  async clearDeviceBinding(criteria: BindingLookup) {
    const serviceKey = toServiceKey(criteria.serviceUrl)
    const services = this.store.get('services')
    const record = cloneServiceRecord(services[serviceKey])
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
          backend.delete('relay-cli:device-binding', bindingAccount(serviceKey, binding)),
        ),
      )
    }

    record.bindings = record.bindings.filter((binding) => !toRemove.includes(binding))
    services[serviceKey] = record
    this.store.set('services', services)
  }

  getSessionSummary(serviceUrl: string) {
    const summaries = this.store.get('summaries')
    return summaries[toServiceKey(serviceUrl)] ?? null
  }

  clearSessionSummary(serviceUrl: string) {
    const serviceKey = toServiceKey(serviceUrl)
    const summaries = this.store.get('summaries')
    delete summaries[serviceKey]
    this.store.set('summaries', summaries)
  }

  setSessionSummary(summary: SessionSummary | null) {
    if (!summary) {
      return
    }

    const serviceKey = toServiceKey(summary.serviceUrl)
    const summaries = this.store.get('summaries')
    summaries[serviceKey] = {
      ...summary,
      serviceUrl: serviceKey,
    }
    this.store.set('summaries', summaries)
    this.store.set('currentServiceUrl', serviceKey)
  }

  async getSnapshot(serviceUrl: string): Promise<CredentialSnapshot> {
    const serviceKey = toServiceKey(serviceUrl)
    const backend = (await this.getKeychainBackend()) ? 'keychain' : 'state-file'
    const record = this.getServiceRecord(serviceKey)

    return {
      backend,
      currentServiceUrl: this.store.get('currentServiceUrl'),
      hasAccessToken: Boolean(await this.getAccessToken(serviceKey)),
      bindingCount: record.bindings.length,
      summary: this.getSessionSummary(serviceKey),
    }
  }

  private getServiceRecord(serviceKey: string) {
    const services = this.store.get('services')
    return cloneServiceRecord(services[serviceKey])
  }

  private async getKeychainBackend() {
    if (!this.keychainPromise) {
      this.keychainPromise = loadKeychainBackend()
    }

    return this.keychainPromise
  }
}

function bindingAccount(serviceKey: string, binding: Pick<StoredBindingRecord, 'userId' | 'deviceId'>) {
  return `${serviceKey}:${binding.userId}:${binding.deviceId}`
}

function cloneServiceRecord(record?: StoredServiceCredentials): StoredServiceCredentials {
  return {
    accessToken: record?.accessToken ?? null,
    refreshToken: record?.refreshToken ?? null,
    bindings: [...(record?.bindings ?? [])],
  }
}

async function loadKeychainBackend(): Promise<SecretBackend | null> {
  const moduleName = 'keytar'

  try {
    const keytarModule = (await import(moduleName)) as {
      default?: {
        getPassword: (service: string, account: string) => Promise<string | null>
        setPassword: (service: string, account: string, password: string) => Promise<void>
        deletePassword: (service: string, account: string) => Promise<boolean>
      }
      getPassword?: (service: string, account: string) => Promise<string | null>
      setPassword?: (service: string, account: string, password: string) => Promise<void>
      deletePassword?: (service: string, account: string) => Promise<boolean>
    }
    const keytar = keytarModule.default ?? keytarModule

    if (!keytar.getPassword || !keytar.setPassword || !keytar.deletePassword) {
      return null
    }

    const getPassword = keytar.getPassword.bind(keytar)
    const setPassword = keytar.setPassword.bind(keytar)
    const deletePassword = keytar.deletePassword.bind(keytar)

    return {
      get: getPassword,
      set: setPassword,
      delete: async (service, account) => {
        await deletePassword(service, account)
      },
    }
  } catch {
    return null
  }
}

function toServiceKey(serviceUrl: string) {
  return serviceUrl.trim().replace(/\/$/, '')
}