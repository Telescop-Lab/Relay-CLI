import { fetch, Headers, type RequestInit } from 'undici'

import { DEVICE_BINDING_COOKIE_NAME, DEFAULT_HTTP_TIMEOUT_MS, RELAY_USER_AGENT } from '../lib/constants.js'
import { createHttpError, type CliError } from '../lib/errors.js'
import type { RelayApiErrorBody } from './types.js'

type QueryValue = string | number | boolean | null | undefined

type RequestOptions = {
  method?: string
  path: string
  query?: Record<string, QueryValue>
  accessToken?: string | null
  bindingCookie?: string | null
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export type ResponseEnvelope<T> = {
  data: T
  status: number
  headers: Headers
}

export class RelayHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options: {
      debug?: boolean
      userAgent?: string
      /** Called when the server returns TOKEN_EXPIRED. Should return a new access token (or throw). */
      onTokenExpired?: () => Promise<string>
    } = {},
  ) {}

  async requestJson<T>(options: RequestOptions): Promise<ResponseEnvelope<T>> {
    const response = await this.requestWithRefresh(options)
    return {
      data: response.body as T,
      status: response.status,
      headers: response.headers,
    }
  }

  async requestVoid(options: RequestOptions) {
    await this.requestWithRefresh(options)
  }

  async extractDeviceBinding(headers: Headers) {
    const headerValues = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headerOrEmpty(headers.get('set-cookie'))

    for (const headerValue of headerValues) {
      const match = headerValue.match(new RegExp(`${DEVICE_BINDING_COOKIE_NAME}=([^;]+)`))
      if (match?.[1]) {
        return decodeURIComponent(match[1])
      }
    }

    return null
  }

  private async requestWithRefresh(options: RequestOptions, isRetry = false): Promise<{
    status: number
    headers: Headers
    body: unknown
  }> {
    try {
      return await this.request(options)
    } catch (error) {
      // Only attempt refresh once, and only for 401 TOKEN_EXPIRED
      if (
        !isRetry &&
        isCliError(error) &&
        (error.status === 401 || error.status === 403) &&
        this.options.onTokenExpired &&
        options.accessToken
      ) {
        try {
          const newToken = await this.options.onTokenExpired()
          return await this.requestWithRefresh({ ...options, accessToken: newToken }, true)
        } catch {
          // Refresh failed — let the original error surface
        }
      }

      throw error
    }
  }

  private async request(options: RequestOptions) {
    const url = buildUrl(this.baseUrl, options.path, options.query)
    const headers = new Headers({
      Accept: 'application/json',
      'User-Agent': this.options.userAgent ?? RELAY_USER_AGENT,
      ...options.headers,
    })

    if (options.accessToken) {
      headers.set('Authorization', `Bearer ${options.accessToken}`)
    }
    if (options.bindingCookie) {
      headers.set('Cookie', `${DEVICE_BINDING_COOKIE_NAME}=${encodeURIComponent(options.bindingCookie)}`)
    }

    let body: RequestInit['body']
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(options.body)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      })

      const contentType = response.headers.get('content-type') ?? ''
      const rawText = await response.text()
      const parsedBody = parseResponseBody(rawText, contentType)

      if (!response.ok) {
        const errorBody = isErrorBody(parsedBody) ? parsedBody : undefined
        throw toHttpCliError(response.status, errorBody, url)
      }

      return {
        status: response.status,
        headers: response.headers,
        body: parsedBody,
      }
    } catch (error) {
      if (isCliError(error)) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw createHttpError('Request timed out', {
          status: 408,
          hint: 'Retry the command, or verify the Relay service is reachable.',
        })
      }

      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildUrl(baseUrl: string, requestPath: string, query: Record<string, QueryValue> | undefined) {
  const url = new URL(requestPath.startsWith('/') ? requestPath : `/${requestPath}`, baseUrl)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) {
      continue
    }

    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

function parseResponseBody(rawText: string, contentType: string) {
  if (!rawText) {
    return null
  }

  if (!contentType.includes('application/json')) {
    return rawText
  }

  try {
    return JSON.parse(rawText) as unknown
  } catch {
    return rawText
  }
}

function headerOrEmpty(value: string | null) {
  return value ? [value] : []
}

function isErrorBody(value: unknown): value is RelayApiErrorBody {
  return typeof value === 'object' && value !== null
}

function isCliError(error: unknown): error is CliError {
  return Boolean(error && typeof error === 'object' && 'exitCode' in error && 'code' in error)
}

function toHttpCliError(status: number, body: RelayApiErrorBody | undefined, url: string) {
  const message = body?.message ?? body?.error ?? `HTTP ${status} from ${url}`
  return createHttpError(message, {
    status,
    details: body,
    hint: status === 401 || status === 403 ? 'Log in again or provide a valid RELAY_TOKEN.' : undefined,
  })
}