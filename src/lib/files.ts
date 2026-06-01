import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import { CliError } from './errors.js'

export async function expandInputPatterns(patterns: string[], cwd = process.cwd()) {
  const matches = new Set<string>()

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim()
    if (!pattern) {
      continue
    }

    if (looksLikeGlob(pattern)) {
      const globMatches = await fg(pattern, {
        cwd,
        absolute: true,
        dot: true,
        onlyFiles: false,
        unique: true,
        followSymbolicLinks: false,
      })
      if (globMatches.length === 0) {
        throw new CliError(`No filesystem entries matched ${pattern}`, {
          hint: 'Check the path or glob pattern before retrying.',
        })
      }
      for (const match of globMatches) {
        matches.add(path.resolve(match))
      }
      continue
    }

    const resolvedPath = path.resolve(cwd, pattern)
    try {
      await fs.access(resolvedPath)
    } catch {
      throw new CliError(`Path not found: ${pattern}`, {
        hint: 'Check the input path before retrying.',
      })
    }

    matches.add(resolvedPath)
  }

  return [...matches].sort((left, right) => left.localeCompare(right))
}

export function resolveCliPath(inputPath: string, cwd = process.cwd()) {
  return path.resolve(cwd, inputPath)
}

export function looksLikeGlob(value: string) {
  return /[*?{}()[\]!]/.test(value)
}