import Conf from 'conf'

import { RELAY_HOME } from './constants.js'
import { CliError } from './errors.js'

type RelayCliConfig = {
  serviceUrl?: string
  defaultWorkspace?: string | null
}

export class ConfigStore {
  private readonly store = new Conf<RelayCliConfig>({
    cwd: RELAY_HOME,
    configName: 'config',
    projectName: 'relay',
    defaults: {
      defaultWorkspace: null,
    },
  })

  getServiceUrl() {
    return this.store.get('serviceUrl') ?? null
  }

  requireServiceUrl() {
    const serviceUrl = this.getServiceUrl()
    if (!serviceUrl) {
      throw new CliError('Relay service URL is not configured', {
        code: 'CONFIG_ERROR',
        hint: 'Set it first with relay config set url <https-url>.',
      })
    }

    return serviceUrl
  }

  setServiceUrl(rawUrl: string) {
    const normalizedUrl = normalizeServiceUrl(rawUrl)
    this.store.set('serviceUrl', normalizedUrl)
    return normalizedUrl
  }

  getDefaultWorkspace() {
    return this.store.get('defaultWorkspace') ?? null
  }

  setDefaultWorkspace(reference: string | null) {
    if (!reference) {
      this.store.delete('defaultWorkspace')
      return
    }

    this.store.set('defaultWorkspace', reference)
  }

  snapshot() {
    return {
      serviceUrl: this.getServiceUrl(),
      defaultWorkspace: this.getDefaultWorkspace(),
    }
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