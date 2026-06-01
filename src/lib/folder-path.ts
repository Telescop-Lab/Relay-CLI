import { CliError } from './errors.js'

export function normalizeFolderPath(rawPath: string) {
  const candidate = rawPath.trim().replace(/\\/g, '/')

  if (!candidate) {
    throw new CliError('Folder path cannot be empty', {
      code: 'INVALID_FOLDER_PATH',
    })
  }

  if (candidate === '/') {
    return '/'
  }

  const normalized = candidate.startsWith('/') ? candidate : `/${candidate}`
  const segments = normalized.split('/').slice(1)

  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new CliError('Folder path must not contain empty segments, . or ..', {
      code: 'INVALID_FOLDER_PATH',
      hint: 'Use / for root, or paths like /design/review.',
    })
  }

  return `/${segments.join('/')}`
}