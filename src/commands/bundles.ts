import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { Command } from 'commander'

import { createBundleUploadPlan } from '../lib/bundle-plan.js'
import {
  buildFolderPathIndex,
  ensureFolderPath,
  fetchFolderTree,
  flattenFolderTree,
  resolveFolderPath,
} from '../lib/folder-tree.js'
import { resolveCliPath } from '../lib/files.js'
import { normalizeFolderPath } from '../lib/folder-path.js'
import { formatBytes, formatTimestamp } from '../lib/formatting.js'
import { CliError } from '../lib/errors.js'
import { confirm } from '../lib/prompts.js'
import { getCommandRuntime } from '../lib/runtime.js'
import { requireAuthenticatedService } from '../lib/service-context.js'
import { resolveWorkspaceReference } from '../lib/workspace-resolver.js'
import { sha256FileHex } from '../lib/sha256.js'
import {
  MULTIPART_THRESHOLD_BYTES,
  isRetryableUploadError,
  uploadMultipartFile,
} from '../lib/multipart.js'
import { mapWithConcurrency, resolveFileConcurrency } from '../lib/concurrency.js'
import type { PlannedBundleFile } from '../lib/bundle-plan.js'
import type { RelayHttpClient } from '../transport/http-client.js'
import type {
  RelayApiBundle,
  RelayApiBundleDownloadUrlsResponse,
  RelayApiBundleFile,
  RelayApiBundleResponse,
  RelayApiBundlesResponse,
  RelayApiBundleUpdateResponse,
  RelayApiSuccessResponse,
} from '../transport/types.js'

type BundleWorkspaceOptions = {
  workspace?: string
}

type BundleListOptions = BundleWorkspaceOptions & {
  folder?: string
  limit?: string | number
}

type BundleInboxOptions = BundleListOptions & {
  includeMine?: boolean
}

type BundlePullOptions = BundleWorkspaceOptions & {
  output: string
}

type BundlePushOptions = BundleWorkspaceOptions & {
  note: string
  folder?: string
  addFolder?: string
  dryRun?: boolean
}

type BundleDeleteOptions = BundleWorkspaceOptions & {
  yes?: boolean
}

type BundleEditOptions = BundleWorkspaceOptions & {
  note?: string
  folder?: string
  addFolder?: string
}

type BundleFileCreateResponse = {
  file: RelayApiBundleFile
}

export function createBundleCommand() {
  const bundle = new Command('bundle')
    .description('Push, list, inspect, pull, and delete bundles')

  bundle
    .command('inbox')
    .description('List unread READY bundles for the current device')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .option('--folder <path>', 'Filter to a specific folder path, for example /design/review')
    .option('--limit <n>', 'Maximum number of bundles to return', '20')
    .option('--include-mine', 'Include bundles created by the current device')
    .action(async (options: BundleInboxOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const folderContext = options.folder
        ? await resolveFolderPath({
            client,
            accessToken,
            workspaceId: workspace.id,
            folderPath: options.folder,
          })
        : await readWorkspaceFolderContext(client, accessToken, workspace.id)
      const response = await client.requestJson<RelayApiBundlesResponse>({
        path: `/api/workspaces/${workspace.id}/bundles`,
        accessToken,
        query: {
          view: 'inbox',
          includeMine: options.includeMine ? 'true' : undefined,
          folderId: options.folder ? toFolderQueryValue(folderContext.folderId) : undefined,
          limit: parseLimit(options.limit),
        },
      })

      const records = presentBundles(response.data.bundles, folderContext.records)
      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace,
          bundles: records,
          nextCursor: response.data.nextCursor,
        })
        return
      }

      runtime.output.writeTable(
        records.map((item) => ({
          id: item.id,
          note: item.note ?? '',
          folder: item.folderPath,
          device: item.deviceName,
          files: item.filesCount,
          size: formatBytes(item.sizeBytes),
          createdAt: formatTimestamp(item.createdAt),
        })),
      )
    })

  bundle
    .command('list')
    .description('List bundles for a workspace')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .option('--folder <path>', 'Filter to a specific folder path, for example /design/review')
    .option('--limit <n>', 'Maximum number of bundles to return', '20')
    .action(async (options: BundleListOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const folderContext = options.folder
        ? await resolveFolderPath({
            client,
            accessToken,
            workspaceId: workspace.id,
            folderPath: options.folder,
          })
        : await readWorkspaceFolderContext(client, accessToken, workspace.id)
      const response = await client.requestJson<RelayApiBundlesResponse>({
        path: `/api/workspaces/${workspace.id}/bundles`,
        accessToken,
        query: {
          folderId: options.folder ? toFolderQueryValue(folderContext.folderId) : undefined,
          limit: parseLimit(options.limit),
        },
      })

      const records = presentBundles(response.data.bundles, folderContext.records)
      if (runtime.options.json) {
        runtime.output.writeJson({
          workspace,
          bundles: records,
          nextCursor: response.data.nextCursor,
        })
        return
      }

      runtime.output.writeTable(
        records.map((item) => ({
          id: item.id,
          note: item.note ?? '',
          status: item.status,
          folder: item.folderPath,
          files: item.filesCount,
          size: formatBytes(item.sizeBytes),
          device: item.deviceName,
          createdAt: formatTimestamp(item.createdAt),
        })),
      )
    })

  bundle
    .command('show <bundle-id>')
    .description('Show bundle metadata and file entries')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .action(async (bundleId: string, options: BundleWorkspaceOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const [bundleResponse, folderContext] = await Promise.all([
        client.requestJson<RelayApiBundleResponse>({
          path: `/api/bundles/${bundleId}`,
          accessToken,
          query: { workspaceId: workspace.id },
        }),
        readWorkspaceFolderContext(client, accessToken, workspace.id),
      ])

      const bundleRecord = presentBundle(bundleResponse.data.bundle, folderContext.records)
      if (runtime.options.json) {
        runtime.output.writeJson(bundleRecord)
        return
      }

      runtime.output.writeLine(`bundle_id: ${bundleRecord.id}`)
      runtime.output.writeLine(`note: ${bundleRecord.note ?? ''}`)
      runtime.output.writeLine(`status: ${bundleRecord.status}`)
      runtime.output.writeLine(`folder: ${bundleRecord.folderPath}`)
      runtime.output.writeLine(`device: ${bundleRecord.deviceName}`)
      runtime.output.writeLine(`files: ${bundleRecord.filesCount}`)
      runtime.output.writeLine(`size: ${formatBytes(bundleRecord.sizeBytes)}`)
      runtime.output.writeLine(`createdAt: ${formatTimestamp(bundleRecord.createdAt)}`)
      runtime.output.writeLine(`finalizedAt: ${formatTimestamp(bundleRecord.finalizedAt)}`)

      if (bundleRecord.files?.length) {
        runtime.output.writeLine()
        runtime.output.writeTable(
          bundleRecord.files.map((file) => ({
            path: file.relativePath ?? file.name,
            mimeType: file.mimeType,
            size: formatBytes(file.sizeBytes),
          })),
        )
      }
    })

  bundle
    .command('pull <bundle-id>')
    .description('Download a bundle into a local directory')
    .requiredOption('--output <dir>', 'Local output directory for the downloaded files')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .action(async (bundleId: string, options: BundlePullOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken, serviceUrl } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const outputDir = resolveCliPath(options.output, runtime.cwd)
      const bundleResponse = await client.requestJson<RelayApiBundleResponse>({
        path: `/api/bundles/${bundleId}`,
        accessToken,
        query: { workspaceId: workspace.id },
      })
      const bundleFiles = bundleResponse.data.bundle.files ?? []

      await ensureDirectory(outputDir)
      const targets = bundleFiles.map((file) => ({
        file,
        outputPath: resolveBundleOutputPath(outputDir, file.relativePath ?? file.name),
      }))

      for (const target of targets) {
        if (await fileExists(target.outputPath)) {
          throw new CliError(`Refusing to overwrite existing file: ${target.outputPath}`, {
            hint: 'Choose an empty output directory or remove the conflicting file first.',
          })
        }
      }

      const downloadResponse = await client.requestJson<RelayApiBundleDownloadUrlsResponse>({
        path: `/api/bundles/${bundleId}/download-urls`,
        accessToken,
        query: { workspaceId: workspace.id },
      })
      const downloadsById = new Map(downloadResponse.data.files.map((file) => [file.id, file]))

      for (const target of targets) {
        const downloadFile = downloadsById.get(target.file.id)
        if (!downloadFile) {
          throw new CliError(`Download URL missing for bundle file ${target.file.name}`)
        }

        await downloadFileToPath(downloadFile.downloadUrl, {
          serviceUrl,
          accessToken,
          outputPath: target.outputPath,
        })
      }

      if (runtime.options.json) {
        runtime.output.writeJson({
          bundleId,
          output: outputDir,
          files: targets.map((target) => ({
            path: target.outputPath,
            relativePath: target.file.relativePath,
            sizeBytes: target.file.sizeBytes,
          })),
        })
        return
      }

      runtime.output.writeLine(
        `Downloaded ${targets.length} file(s) from ${bundleResponse.data.bundle.id} to ${outputDir}`,
      )
    })

  bundle
    .command('push <path-or-glob>')
    .description('Create a bundle from local files and upload it to Relay')
    .requiredOption('--note <text>', 'Human-readable note attached to the bundle')
    .option('--folder <path>', 'Upload into an existing folder path')
    .option('--add-folder <path>', 'Create missing folder path segments before upload')
    .option('--workspace <workspace-id|name>', 'Workspace to upload into instead of the local default')
    .option('--dry-run', 'Resolve the upload plan without creating a bundle or uploading files')
    .action(async (pathOrGlob: string, options: BundlePushOptions, command: Command) => {
      if (options.folder && options.addFolder) {
        throw new CliError('Use either --folder or --add-folder, not both')
      }

      if (options.note.trim().length === 0) {
        throw new CliError('Bundle note cannot be empty', {
          hint: 'Provide a non-empty --note, like a git commit message.',
        })
      }

      const runtime = await getCommandRuntime(command)
      const { client, accessToken, serviceUrl } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const uploadPlan = await createBundleUploadPlan(pathOrGlob, runtime.cwd)
      const folderTarget = await resolvePushFolderTarget({
        client,
        accessToken,
        workspaceId: workspace.id,
        folderPath: options.folder,
        addFolderPath: options.addFolder,
        dryRun: Boolean(options.dryRun),
      })

      if (options.dryRun) {
        const payload = {
          workspace,
          folderPath: folderTarget.folderPath,
          folderAction: folderTarget.folderAction,
          fileCount: uploadPlan.files.length,
          totalBytes: uploadPlan.totalBytes,
          files: uploadPlan.files.map((file) => ({
            source: file.absolutePath,
            targetPath: file.relativePath ?? file.name,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
          })),
        }

        if (runtime.options.json) {
          runtime.output.writeJson(payload)
          return
        }

        runtime.output.writeLine(`workspace: ${workspace.name} (${workspace.id})`)
        runtime.output.writeLine(`folder: ${folderTarget.folderPath}`)
        runtime.output.writeLine(`folderAction: ${folderTarget.folderAction}`)
        runtime.output.writeLine(`files: ${uploadPlan.files.length}`)
        runtime.output.writeLine(`totalBytes: ${formatBytes(uploadPlan.totalBytes)}`)
        runtime.output.writeLine()
        runtime.output.writeTable(
          uploadPlan.files.map((file) => ({
            source: file.absolutePath,
            targetPath: file.relativePath ?? file.name,
            size: formatBytes(file.sizeBytes),
            mimeType: file.mimeType,
          })),
        )
        return
      }

      const createBundleResponse = await client.requestJson<RelayApiBundleResponse>({
        method: 'POST',
        path: `/api/workspaces/${workspace.id}/bundles`,
        accessToken,
        body: {
          note: options.note,
          ...(folderTarget.folderId ? { folderId: folderTarget.folderId } : {}),
        },
      })
      const createdBundleId = createBundleResponse.data.bundle.id

      const uploadedFiles = await mapWithConcurrency(uploadPlan.files, resolveFileConcurrency(), (file) =>
        pushBundleFile({
          client,
          accessToken,
          serviceUrl,
          workspaceId: workspace.id,
          bundleId: createdBundleId,
          file,
        }),
      )

      await client.requestJson<RelayApiBundleResponse>({
        method: 'POST',
        path: `/api/bundles/${createdBundleId}/finalize`,
        accessToken,
        query: { workspaceId: workspace.id },
      })

      const bundleResponse = await client.requestJson<RelayApiBundleResponse>({
        path: `/api/bundles/${createdBundleId}`,
        accessToken,
        query: { workspaceId: workspace.id },
      })
      const bundleRecord = presentBundle(bundleResponse.data.bundle, folderTarget.records)

      if (runtime.options.json) {
        runtime.output.writeJson({
          bundle: bundleRecord,
          uploadedFiles: uploadPlan.files.length,
          totalBytes: uploadPlan.totalBytes,
          files: uploadedFiles,
        })
        return
      }

      runtime.output.writeLine(`Created bundle ${bundleRecord.id} in ${workspace.name}`)
      runtime.output.writeLine(`folder: ${bundleRecord.folderPath}`)
      runtime.output.writeLine(`files: ${uploadPlan.files.length}`)
      runtime.output.writeLine(`size: ${formatBytes(uploadPlan.totalBytes)}`)
    })

  const deleteCommand = bundle
    .command('delete <bundle-id>')
    .alias('rm')
    .description('Move a bundle to trash (recoverable for 30 days)')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .option('--yes', 'Skip the local confirmation prompt')
    .action(async (bundleId: string, options: BundleDeleteOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })
      const bundleResponse = await client.requestJson<RelayApiBundleResponse>({
        path: `/api/bundles/${bundleId}`,
        accessToken,
        query: { workspaceId: workspace.id },
      })

      if (!options.yes) {
        const accepted = await confirm(`Move bundle ${bundleResponse.data.bundle.id} to trash? It can be restored within 30 days`, false)
        if (!accepted) {
          if (runtime.options.json) {
            runtime.output.writeJson({ success: false, cancelled: true })
          } else {
            runtime.output.warn('Bundle deletion cancelled.')
          }
          return
        }
      }

      await client.requestJson<RelayApiSuccessResponse>({
        method: 'DELETE',
        path: `/api/bundles/${bundleId}`,
        accessToken,
        query: { workspaceId: workspace.id },
      })

      if (runtime.options.json) {
        runtime.output.writeJson({ success: true, bundleId })
        return
      }

      runtime.output.writeLine(`Moved bundle ${bundleId} to trash (restore with undo within 30 days)`)
    })

  deleteCommand.alias('remove')

  bundle
    .command('restore <bundle-id>')
    .description('Restore a bundle from trash')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .action(async (bundleId: string, options: BundleWorkspaceOptions, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      const response = await client.requestJson<RelayApiBundleResponse>({
        method: 'POST',
        path: `/api/bundles/${bundleId}/restore`,
        accessToken,
        query: { workspaceId: workspace.id },
      })
      const bundle = response.data.bundle

      if (runtime.options.json) {
        runtime.output.writeJson({ bundle })
        return
      }

      runtime.output.writeLine(`Restored bundle ${bundle.id} (${bundle.filesCount} file(s))`)
    })

  bundle
    .command('edit <bundle-id>')
    .description('Update a bundle note or move it to another folder')
    .option('--note <text>', 'New note text for the bundle')
    .option('--folder <path>', 'Move the bundle to an existing folder path (use / for root)')
    .option('--add-folder <path>', 'Move the bundle to a folder path, creating missing segments')
    .option('--workspace <workspace-id|name>', 'Workspace to inspect instead of the local default')
    .action(async (bundleId: string, options: BundleEditOptions, command: Command) => {
      if (options.folder && options.addFolder) {
        throw new CliError('Use either --folder or --add-folder, not both')
      }

      if (
        options.note === undefined &&
        options.folder === undefined &&
        options.addFolder === undefined
      ) {
        throw new CliError('Provide --note, --folder, --add-folder, or any combination')
      }

      if (options.note !== undefined && options.note.trim().length === 0) {
        throw new CliError('Bundle note cannot be empty', {
          hint: 'Provide a non-empty --note, like a git commit message.',
        })
      }

      const runtime = await getCommandRuntime(command)
      const { client, accessToken } = await requireAuthenticatedService(runtime)
      const workspace = await resolveWorkspaceReference({
        explicitReference: options.workspace,
        config: runtime.config,
        client,
        accessToken,
      })

      let folderId: string | null | undefined
      if (options.folder !== undefined) {
        const folderContext = await resolveFolderPath({
          client,
          accessToken,
          workspaceId: workspace.id,
          folderPath: options.folder,
        })
        folderId = folderContext.folderId
      } else if (options.addFolder !== undefined) {
        const folderContext = await ensureFolderPath({
          client,
          accessToken,
          workspaceId: workspace.id,
          folderPath: options.addFolder,
        })
        folderId = folderContext.folderId
      }

      const response = await client.requestJson<RelayApiBundleUpdateResponse>({
        method: 'PATCH',
        path: `/api/bundles/${bundleId}`,
        accessToken,
        query: { workspaceId: workspace.id },
        body: {
          ...(options.note !== undefined ? { note: options.note } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
        },
      })

      if (runtime.options.json) {
        runtime.output.writeJson(response.data)
        return
      }

      const changed: string[] = []
      if (options.note !== undefined) changed.push('note updated')
      if (options.folder !== undefined || options.addFolder !== undefined) {
        changed.push('folder updated')
      }
      runtime.output.writeLine(`Updated bundle ${bundleId} (${changed.join(', ')})`)
    })

  return bundle
}

async function readWorkspaceFolderContext(
  client: Parameters<typeof fetchFolderTree>[0],
  accessToken: string,
  workspaceId: string,
) {
  const folders = await fetchFolderTree(client, accessToken, workspaceId)
  const records = flattenFolderTree(folders)

  return {
    folders,
    records,
    folderId: null,
    folderPath: '/',
    created: false,
    folderAction: 'reuse' as const,
  }
}

async function resolvePushFolderTarget(options: {
  client: Parameters<typeof fetchFolderTree>[0]
  accessToken: string
  workspaceId: string
  folderPath?: string
  addFolderPath?: string
  dryRun: boolean
}) {
  if (!options.folderPath && !options.addFolderPath) {
    return await readWorkspaceFolderContext(options.client, options.accessToken, options.workspaceId)
  }

  if (options.folderPath) {
    const resolved = await resolveFolderPath({
      client: options.client,
      accessToken: options.accessToken,
      workspaceId: options.workspaceId,
      folderPath: options.folderPath,
    })

    return {
      ...resolved,
      folderAction: 'reuse' as const,
    }
  }

  if (!options.addFolderPath) {
    return await readWorkspaceFolderContext(options.client, options.accessToken, options.workspaceId)
  }

  const normalizedFolderPath = normalizeFolderPath(options.addFolderPath)

  if (!options.dryRun) {
    const ensured = await ensureFolderPath({
      client: options.client,
      accessToken: options.accessToken,
      workspaceId: options.workspaceId,
      folderPath: normalizedFolderPath,
    })

    return {
      ...ensured,
      folderAction: ensured.created ? 'create' : 'reuse',
    }
  }

  const context = await readWorkspaceFolderContext(options.client, options.accessToken, options.workspaceId)
  const resolved = buildFolderPathIndex(context.records).get(normalizedFolderPath)

  return {
    ...context,
    folderId: resolved?.id ?? null,
    folderPath: normalizedFolderPath,
    folderAction: resolved ? 'reuse' : 'create',
  }
}

function presentBundles(bundles: RelayApiBundle[], records: Awaited<ReturnType<typeof readWorkspaceFolderContext>>['records']) {
  return bundles.map((bundle) => presentBundle(bundle, records))
}

function presentBundle(bundle: RelayApiBundle, records: Awaited<ReturnType<typeof readWorkspaceFolderContext>>['records']) {
  const folderIdIndex = new Map(records.map((record) => [record.id, record.path]))
  return {
    ...bundle,
    folderPath: bundle.folderId ? folderIdIndex.get(bundle.folderId) ?? '/' : '/',
  }
}

function parseLimit(rawLimit: string | number | undefined) {
  const numeric = Number(rawLimit ?? 20)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('Limit must be a positive integer')
  }

  return numeric
}

function toFolderQueryValue(folderId: string | null) {
  return folderId ?? 'root'
}

async function ensureDirectory(directoryPath: string) {
  const stat = await fs.stat(directoryPath).catch(() => null)
  if (stat && !stat.isDirectory()) {
    throw new CliError(`Output path is not a directory: ${directoryPath}`)
  }

  await fs.mkdir(directoryPath, { recursive: true })
}

async function fileExists(filePath: string) {
  return Boolean(await fs.stat(filePath).catch(() => null))
}

function resolveBundleOutputPath(outputDir: string, relativePath: string) {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/')
  const candidate = path.resolve(outputDir, normalizedRelativePath)
  const relativeToRoot = path.relative(outputDir, candidate)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new CliError(`Invalid bundle file path: ${relativePath}`)
  }

  return candidate
}

const MAX_FILE_UPLOAD_RETRIES = 3
const FILE_RETRY_BASE_DELAY_MS = 500

type UploadMode = 'single' | 'multipart'

type UploadResult = {
  name: string
  relativePath: string | null
  sizeBytes: number
  uploadMode: UploadMode
}

async function pushBundleFile(options: {
  client: RelayHttpClient
  accessToken: string
  serviceUrl: string
  workspaceId: string
  bundleId: string
  file: PlannedBundleFile
}): Promise<UploadResult> {
  const { client, accessToken, serviceUrl, workspaceId, bundleId, file } = options

  // Compute the file's SHA-256 once, before registration, so the record stores
  // it for finalize verification (local storage) and future CAS dedup. R2 does
  // not validate flexible checksums on presigned PUTs, so we do not send a
  // checksum header on the wire — TLS covers transport integrity.
  const checksumSha256 = await sha256FileHex(file.absolutePath)

  // Register the file exactly once. This creates a BundleFile record server-side,
  // so it must not be retried — a retry after a lost response would create a
  // duplicate record that fails finalize's headObject check.
  const registerResponse = await client.requestJson<BundleFileCreateResponse>({
    method: 'POST',
    path: `/api/bundles/${bundleId}/files`,
    accessToken,
    query: { workspaceId },
    body: {
      name: file.name,
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      checksumSha256,
    },
  })

  const uploadMode = await uploadFileWithRetry({
    client,
    accessToken,
    serviceUrl,
    workspaceId,
    bundleId,
    fileId: registerResponse.data.file.id,
    uploadUrl: registerResponse.data.file.uploadUrl ?? '',
    filePath: file.absolutePath,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  })

  return {
    name: file.name,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    uploadMode,
  }
}

async function uploadFileWithRetry(options: {
  client: RelayHttpClient
  accessToken: string
  serviceUrl: string
  workspaceId: string
  bundleId: string
  fileId: string
  uploadUrl: string
  filePath: string
  mimeType: string
  sizeBytes: number
}): Promise<UploadMode> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_FILE_UPLOAD_RETRIES; attempt += 1) {
    try {
      return await uploadFileToUrl(options)
    } catch (error) {
      lastError = error
      if (attempt >= MAX_FILE_UPLOAD_RETRIES || !isRetryableUploadError(error)) {
        throw error
      }
      await sleep(FILE_RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function uploadFileToUrl(options: {
  client: RelayHttpClient
  accessToken: string
  serviceUrl: string
  workspaceId: string
  bundleId: string
  fileId: string
  uploadUrl: string
  filePath: string
  mimeType: string
  sizeBytes: number
}): Promise<UploadMode> {
  if (!options.uploadUrl) {
    throw new CliError('Bundle upload URL was missing from the service response')
  }

  const target = resolveTransferTarget(options.uploadUrl, options.serviceUrl)

  // Local/dev fallback (relative, authenticated) always uses a single PUT.
  // Multipart only applies to direct R2 presigned uploads and larger files.
  if (target.requiresAuth || options.sizeBytes < MULTIPART_THRESHOLD_BYTES) {
    await singlePutFile(options.filePath, options.mimeType, target, options.accessToken)
    return 'single'
  }

  await uploadMultipartFile({
    client: options.client,
    accessToken: options.accessToken,
    workspaceId: options.workspaceId,
    bundleId: options.bundleId,
    fileId: options.fileId,
    filePath: options.filePath,
    mimeType: options.mimeType,
    sizeBytes: options.sizeBytes,
  })
  return 'multipart'
}

async function singlePutFile(
  filePath: string,
  mimeType: string,
  target: { url: string; requiresAuth: boolean },
  accessToken: string,
) {
  const fileStats = await fs.stat(filePath)
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    // R2/S3 presigned PUT uploads reject chunked bodies (411 MissingContentLength).
    // Native fetch streams a ReadStream via chunked transfer unless we declare
    // the length explicitly, so stat the file and set Content-Length ourselves.
    'Content-Length': String(fileStats.size),
  }

  if (target.requiresAuth) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const response = await fetch(target.url, {
    method: 'PUT',
    headers,
    body: createReadStream(filePath),
    duplex: 'half',
  })

  if (!response.ok) {
    const message = await response.text()
    throw new CliError(`Upload failed with HTTP ${response.status}: ${message || target.url}`, {
      status: response.status,
    })
  }

  await response.text().catch(() => '')
}

async function downloadFileToPath(
  rawUrl: string,
  options: { serviceUrl: string; accessToken: string; outputPath: string },
) {
  const target = resolveTransferTarget(rawUrl, options.serviceUrl)
  const headers: Record<string, string> = {}

  if (target.requiresAuth) {
    headers.Authorization = `Bearer ${options.accessToken}`
  }

  const response = await fetch(target.url, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new CliError(`Download failed with HTTP ${response.status}: ${message || target.url}`)
  }

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true })

  try {
    if (!response.body) {
      throw new CliError('Download response body was empty')
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      createWriteStream(options.outputPath),
    )
  } catch (error) {
    await fs.unlink(options.outputPath).catch(() => undefined)
    throw error
  }
}

function resolveTransferTarget(rawUrl: string, serviceUrl: string) {
  const requiresAuth = rawUrl.startsWith('/')
  return {
    url: requiresAuth ? new URL(rawUrl, serviceUrl).toString() : rawUrl,
    requiresAuth,
  }
}