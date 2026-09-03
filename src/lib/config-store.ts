import Conf from 'conf'

import { DEFAULT_PROFILE, RELAY_HOME } from './constants.js'
import { CliError } from './errors.js'

type ProfileConfig = {
  serviceUrl?: string
  defaultWorkspace?: string | null
}

type RelayCliConfig = {
  currentProfile?: string
  profiles?: Record<string, ProfileConfig>
}

export class ConfigStore {
  private readonly store: Conf<RelayCliConfig>
  private activeProfile: string | null = null

  constructor() {
    this.store = new Conf<RelayCliConfig>({
      cwd: RELAY_HOME,
      configName: 'config',
      projectName: 'relay',
      defaults: {
        currentProfile: DEFAULT_PROFILE,
        profiles: {},
      },
    })

    this.migrateLegacyConfig()
  }

  /** Override the profile used by default for this invocation (e.g. via --profile). */
  setActiveProfile(profile: string) {
    this.activeProfile = normalizeProfileName(profile)
  }

  getCurrentProfile() {
    return this.activeProfile ?? this.store.get('currentProfile') ?? DEFAULT_PROFILE
  }

  getPersistedProfile() {
    return this.store.get('currentProfile') ?? DEFAULT_PROFILE
  }

  setCurrentProfile(profile: string) {
    const normalized = normalizeProfileName(profile)
    this.ensureProfile(normalized)
    this.store.set('currentProfile', normalized)
    this.activeProfile = normalized
    return normalized
  }

  listProfiles() {
    const profiles = this.store.get('profiles') ?? {}
    const currentProfile = this.getPersistedProfile()

    return Object.entries(profiles).map(([name, config]) => ({
      name,
      current: name === currentProfile,
      serviceUrl: config.serviceUrl ?? null,
      defaultWorkspace: config.defaultWorkspace ?? null,
    }))
  }

  removeProfile(profile: string) {
    const normalized = normalizeProfileName(profile)
    const profiles = this.store.get('profiles') ?? {}

    if (!profiles[normalized]) {
      throw new CliError(`Profile not found: ${normalized}`, {
        code: 'PROFILE_NOT_FOUND',
        hint: 'Run relay config profile list to inspect available profiles.',
      })
    }

    if (normalized === this.getPersistedProfile()) {
      throw new CliError(`Cannot remove the active profile: ${normalized}`, {
        code: 'PROFILE_IN_USE',
        hint: 'Switch to another profile first with relay config profile use <name>.',
      })
    }

    delete profiles[normalized]
    this.store.set('profiles', profiles)
  }

  getServiceUrl(profile = this.getCurrentProfile()) {
    return this.getProfileConfig(profile).serviceUrl ?? null
  }

  requireServiceUrl(profile = this.getCurrentProfile()) {
    const serviceUrl = this.getServiceUrl(profile)
    if (!serviceUrl) {
      throw new CliError('Relay service URL is not configured', {
        code: 'CONFIG_ERROR',
        hint: 'Set it first with relay config set url <https-url>.',
      })
    }

    return serviceUrl
  }

  setServiceUrl(rawUrl: string, profile = this.getCurrentProfile()) {
    const normalizedUrl = normalizeServiceUrl(rawUrl)
    const normalizedProfile = normalizeProfileName(profile)
    this.ensureProfile(normalizedProfile)

    const profiles = this.store.get('profiles') ?? {}
    profiles[normalizedProfile] = {
      ...profiles[normalizedProfile],
      serviceUrl: normalizedUrl,
    }
    this.store.set('profiles', profiles)
    return normalizedUrl
  }

  getDefaultWorkspace(profile = this.getCurrentProfile()) {
    return this.getProfileConfig(profile).defaultWorkspace ?? null
  }

  setDefaultWorkspace(reference: string | null, profile = this.getCurrentProfile()) {
    const normalizedProfile = normalizeProfileName(profile)
    this.ensureProfile(normalizedProfile)

    const profiles = this.store.get('profiles') ?? {}
    const current = profiles[normalizedProfile] ?? {}

    if (!reference) {
      delete current.defaultWorkspace
    } else {
      current.defaultWorkspace = reference
    }

    profiles[normalizedProfile] = current
    this.store.set('profiles', profiles)
  }

  snapshot(profile = this.getCurrentProfile()) {
    return {
      profile,
      serviceUrl: this.getServiceUrl(profile),
      defaultWorkspace: this.getDefaultWorkspace(profile),
    }
  }

  private getProfileConfig(profile: string) {
    const profiles = this.store.get('profiles') ?? {}
    return profiles[profile] ?? {}
  }

  private ensureProfile(profile: string) {
    const profiles = this.store.get('profiles') ?? {}
    if (!profiles[profile]) {
      profiles[profile] = {}
      this.store.set('profiles', profiles)
    }
  }

  private migrateLegacyConfig() {
    const raw = this.store.store as unknown as {
      serviceUrl?: string
      defaultWorkspace?: string | null
      profiles?: Record<string, ProfileConfig>
    }

    if (!raw.serviceUrl && raw.defaultWorkspace === undefined) {
      return
    }

    const profiles = raw.profiles ?? {}
    if (!profiles[DEFAULT_PROFILE]) {
      profiles[DEFAULT_PROFILE] = {}
    }
    if (raw.serviceUrl) {
      profiles[DEFAULT_PROFILE].serviceUrl = raw.serviceUrl
    }
    if (raw.defaultWorkspace !== undefined) {
      profiles[DEFAULT_PROFILE].defaultWorkspace = raw.defaultWorkspace
    }

    this.store.set('profiles', profiles)
    this.store.delete('serviceUrl' as never)
    this.store.delete('defaultWorkspace' as never)
  }
}

export function normalizeServiceUrl(rawUrl: string) {
  const value = rawUrl.trim()
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new CliError('Service URL must be a valid absolute URL', {
      code: 'INVALID_SERVICE_URL',
      hint: 'Use an https:// URL, or http://127.0.0.1:<port> for local development.',
    })
  }

  const isSecure = parsed.protocol === 'https:'
  const isAllowedLocalHttp =
    parsed.protocol === 'http:' &&
    parsed.hostname === '127.0.0.1' &&
    parsed.port.length > 0

  if (!isSecure && !isAllowedLocalHttp) {
    throw new CliError('Service URL must use https, except for explicit local 127.0.0.1 development URLs', {
      code: 'INVALID_SERVICE_URL',
      hint: 'Use an https:// URL, or http://127.0.0.1:<port> for local development.',
    })
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  if (parsed.pathname === '/') {
    parsed.pathname = ''
  }
  parsed.search = ''
  parsed.hash = ''

  return parsed.toString().replace(/\/$/, '')
}

export function normalizeProfileName(rawName: string) {
  const value = rawName.trim()
  if (!value) {
    throw new CliError('Profile name cannot be empty', {
      code: 'INVALID_PROFILE',
    })
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new CliError('Profile name may only contain letters, digits, dot, underscore, and hyphen', {
      code: 'INVALID_PROFILE',
    })
  }

  return value
}
