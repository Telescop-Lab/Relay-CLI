export const ExitCode = {
  Success: 0,
  RuntimeError: 1,
  AuthFailure: 2,
  QuotaExceeded: 3,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]