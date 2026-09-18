import path from 'node:path'

export function resolveCliPath(inputPath: string, cwd = process.cwd()) {
  return path.resolve(cwd, inputPath)
}

export function looksLikeGlob(value: string) {
  return /[*?{}()[\]!]/.test(value)
}