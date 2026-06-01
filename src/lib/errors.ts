import type { CommanderError } from 'commander'

import { ExitCode, type ExitCodeValue } from './exit-codes.js'

export type CliErrorCode =
  | 'AUTH_REQUIRED'
  | 'COMMAND_ERROR'
  | 'CONFIG_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_FOLDER_PATH'
  | 'INVALID_SERVICE_URL'
  | 'QUOTA_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'WORKSPACE_AMBIGUOUS'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_REQUIRED'

type CliErrorOptions = {
  code?: CliErrorCode
  exitCode?: ExitCodeValue
  details?: unknown
  hint?: string
  status?: number
  cause?: unknown
}

export class CliError extends Error {
  readonly code: CliErrorCode
  readonly exitCode: ExitCodeValue
  readonly details?: unknown
  readonly hint?: string
  readonly status?: number
  override readonly cause?: unknown

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message)
    this.name = 'CliError'
    this.code = options.code ?? 'RUNTIME_ERROR'
    this.exitCode = options.exitCode ?? ExitCode.RuntimeError
    this.details = options.details
    this.hint = options.hint
    this.status = options.status
    this.cause = options.cause
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError
}

export function isCommanderError(error: unknown): error is CommanderError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'exitCode' in error &&
      'message' in error,
  )
}

export function isCommanderHelpDisplay(error: unknown) {
  return isCommanderError(error) && error.code === 'commander.helpDisplayed'
}

export function commanderErrorToCliError(error: CommanderError) {
  if (error.code === 'commander.helpDisplayed') {
    return new CliError('', {
      code: 'COMMAND_ERROR',
      exitCode: ExitCode.Success,
    })
  }

  if (isCliErrorCode(error.code)) {
    return new CliError(error.message, {
      code: error.code,
      exitCode: exitCodeForCliErrorCode(error.code),
      details: { commanderCode: error.code },
    })
  }

  return new CliError(error.message, {
    code: 'COMMAND_ERROR',
    exitCode: ExitCode.RuntimeError,
    details: { commanderCode: error.code },
  })
}

export function createHttpError(
  message: string,
  options: {
    status: number
    details?: unknown
    hint?: string
  },
) {
  if (options.status === 401 || options.status === 403) {
    return new CliError(message, {
      code: 'AUTH_REQUIRED',
      exitCode: ExitCode.AuthFailure,
      status: options.status,
      details: options.details,
      hint: options.hint,
    })
  }

  const quotaExceeded =
    typeof options.details === 'object' &&
    options.details !== null &&
    'error' in options.details &&
    options.details.error === 'QUOTA_EXCEEDED'

  if (options.status === 413 && quotaExceeded) {
    return new CliError(message, {
      code: 'QUOTA_EXCEEDED',
      exitCode: ExitCode.QuotaExceeded,
      status: options.status,
      details: options.details,
      hint: options.hint,
    })
  }

  return new CliError(message, {
    code: 'HTTP_ERROR',
    exitCode: ExitCode.RuntimeError,
    status: options.status,
    details: options.details,
    hint: options.hint,
  })
}

export function toCliError(error: unknown): CliError {
  if (isCliError(error)) {
    return error
  }

  if (isCommanderError(error)) {
    return commanderErrorToCliError(error)
  }

  if (error instanceof Error) {
    return new CliError(error.message, {
      cause: error,
      details: {
        name: error.name,
      },
    })
  }

  return new CliError('Unexpected CLI failure', {
    details: error,
  })
}

function isCliErrorCode(value: unknown): value is CliErrorCode {
  return typeof value === 'string' && [
    'AUTH_REQUIRED',
    'COMMAND_ERROR',
    'CONFIG_ERROR',
    'HTTP_ERROR',
    'INVALID_FOLDER_PATH',
    'INVALID_SERVICE_URL',
    'QUOTA_EXCEEDED',
    'RUNTIME_ERROR',
    'WORKSPACE_AMBIGUOUS',
    'WORKSPACE_NOT_FOUND',
    'WORKSPACE_REQUIRED',
  ].includes(value)
}

function exitCodeForCliErrorCode(code: CliErrorCode): ExitCodeValue {
  if (code === 'AUTH_REQUIRED') {
    return ExitCode.AuthFailure
  }

  if (code === 'QUOTA_EXCEEDED') {
    return ExitCode.QuotaExceeded
  }

  return ExitCode.RuntimeError
}