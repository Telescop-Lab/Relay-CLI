import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import { CliError } from './errors.js'
import { looksLikeGlob, resolveCliPath } from './files.js'

export interface PlannedBundleFile {
  absolutePath: string
  name: string
  relativePath: string | null
  sizeBytes: number
  mimeType: string
}

export interface BundleUploadPlan {
  source: string
  files: PlannedBundleFile[]
  totalBytes: number
}

export async function createBundleUploadPlan(source: string, cwd = process.cwd()): Promise<BundleUploadPlan> {
  const trimmedSource = source.trim()
  if (!trimmedSource) {
    throw new CliError('A source path or glob is required for bundle push')
  }

  const files = looksLikeGlob(trimmedSource)
    ? await planFromGlob(trimmedSource, cwd)
    : await planFromPath(trimmedSource, cwd)

  if (files.length === 0) {
    throw new CliError(`No files found for ${trimmedSource}`)
  }

  const deduped = dedupBundleFiles(files)

  return {
    source: trimmedSource,
    files: deduped,
    totalBytes: deduped.reduce((sum, file) => sum + file.sizeBytes, 0),
  }
}

/**
 * Ensure every file inside a bundle has a unique path.
 *
 * Collision key = `relativePath ?? name`.  When duplicate keys are detected
 * (e.g. two files both claiming `results.csv`), later entries receive a
 * `_1`, `_2`, … suffix before the extension so that every staged entry
 * has a unique key inside the bundle.
 *
 * Matches the Web-side `deduplicateIncoming` in `BundleStaging/index.tsx`.
 */
function dedupBundleFiles(files: PlannedBundleFile[]): PlannedBundleFile[] {
  const used = new Set<string>()
  const result: PlannedBundleFile[] = []

  for (const file of files) {
    const baseKey = file.relativePath ?? file.name
    let resolvedKey = baseKey

    if (used.has(resolvedKey)) {
      const dotIndex = resolvedKey.lastIndexOf('.')
      const stem = dotIndex === -1 ? resolvedKey : resolvedKey.slice(0, dotIndex)
      const ext = dotIndex === -1 ? '' : resolvedKey.slice(dotIndex)
      let counter = 1
      do {
        resolvedKey = `${stem}_${counter}${ext}`
        counter += 1
      } while (used.has(resolvedKey))
    }

    used.add(resolvedKey)
    result.push(
      resolvedKey === baseKey
        ? file
        : { ...file, relativePath: file.relativePath === null ? resolvedKey : resolvedKey },
    )
  }

  return result
}

async function planFromPath(inputPath: string, cwd: string) {
  const resolvedPath = resolveCliPath(inputPath, cwd)
  const stat = await fs.stat(resolvedPath).catch(() => null)
  if (!stat) {
    throw new CliError(`Path not found: ${inputPath}`, {
      hint: 'Check the input path before retrying.',
    })
  }

  if (stat.isFile()) {
    return [await createPlannedFile(resolvedPath, null)]
  }

  if (!stat.isDirectory()) {
    throw new CliError(`Unsupported input path: ${inputPath}`)
  }

  const files = await fg('**/*', {
    cwd: resolvedPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })

  // Preserve the directory's own name so that uploading `tests` produces
  // relative paths like `tests/web/a.md` (instead of `web/a.md`), letting the
  // receiving device reconstruct the folder as a folder.
  const directoryName = path.basename(resolvedPath)

  return Promise.all(
    files.sort((left, right) => left.localeCompare(right)).map(async (filePath) => {
      const relativePath = normalizeRelativePath(
        path.join(directoryName, path.relative(resolvedPath, filePath)),
      )
      return createPlannedFile(filePath, relativePath)
    }),
  )
}

async function planFromGlob(pattern: string, cwd: string) {
  const matches = await fg(pattern, {
    cwd,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })

  if (matches.length === 0) {
    throw new CliError(`No filesystem entries matched ${pattern}`, {
      hint: 'Check the path or glob pattern before retrying.',
    })
  }

  const rootPath = resolveGlobBase(pattern, cwd)
  return Promise.all(
    matches.sort((left, right) => left.localeCompare(right)).map(async (filePath) => {
      const relativePath = normalizeRelativePath(path.relative(rootPath, filePath))
      return createPlannedFile(filePath, relativePath)
    }),
  )
}

async function createPlannedFile(absolutePath: string, relativePath: string | null) {
  const stat = await fs.stat(absolutePath)
  return {
    absolutePath,
    name: path.basename(absolutePath),
    relativePath,
    sizeBytes: stat.size,
    mimeType: guessMimeType(absolutePath),
  } satisfies PlannedBundleFile
}

function resolveGlobBase(pattern: string, cwd: string) {
  const absolutePattern = path.resolve(cwd, pattern)
  const parsed = path.parse(absolutePattern)
  const remainder = absolutePattern.slice(parsed.root.length)
  const parts = remainder.split(path.sep).filter(Boolean)
  const baseParts: string[] = []

  for (const part of parts) {
    if (/[*?{}()[\]!]/.test(part)) {
      break
    }

    baseParts.push(part)
  }

  return path.join(parsed.root, ...baseParts)
}

function normalizeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/')
  return normalized && normalized !== '.' ? normalized : null
}

function guessMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.csv': 'text/csv',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.xml': 'application/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.zip': 'application/zip',
  }

  return map[extension] ?? 'application/octet-stream'
}