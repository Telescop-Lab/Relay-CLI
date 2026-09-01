import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'

import { CliError } from './errors.js'
import type { RelayHttpClient } from '../transport/http-client.js'
import type {
  RelayApiMultipartCompleteResponse,
  RelayApiMultipartInitResponse,
  RelayApiMultipartPartsResponse,
} from '../transport/types.js'

/**
 * Files below this size use a single presigned PUT; larger files switch to a
 * multipart upload so the byte stream can be split into parallel parts.
 */
export const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024

/** S3/R2 hard cap on the number of parts in a single multipart upload. */
export const MAX_MULTIPART_PARTS = 10_000

const DEFAULT_MAX_CONCURRENCY = 4
const MAX_PART_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500

export interface MultipartUploadContext {
  client: RelayHttpClient
  accessToken: string
  workspaceId: string
  bundleId: string
  fileId: string
  filePath: string
  mimeType: string
  sizeBytes: number
}

/**
 * Upload a single file via S3/R2 multipart upload:
 *   1. init      — server creates the multipart session (returns uploadId + partSize)
 *   2. parts     — server signs presigned PUT URLs for every part
 *   3. upload    — bounded-concurrency workers PUT each part with per-part retry
 *   4. complete  — server assembles the object from the collected ETags
 *   5. abort     — best-effort cleanup when anything fails
 */
export async function uploadMultipartFile(context: MultipartUploadContext): Promise<void> {
  const { client, accessToken, workspaceId, bundleId, fileId, filePath, mimeType, sizeBytes } =
    context

  const init = await client.requestJson<RelayApiMultipartInitResponse>({
    method: 'POST',
    path: `/api/bundles/${bundleId}/files/${fileId}/multipart/init`,
    accessToken,
    query: { workspaceId },
    body: { contentType: mimeType },
  })

  const { uploadId, partSize } = init.data
  const partCount = computePartCount(sizeBytes, partSize)

  if (partCount > MAX_MULTIPART_PARTS) {
    await abortUpload(context, uploadId)
    throw new CliError(
      `File ${filePath} would require ${partCount} parts (${partSize} bytes each), ` +
        `exceeding the ${MAX_MULTIPART_PARTS}-part limit`,
      { hint: 'Increase R2_MULTIPART_PART_SIZE on the server and retry.' },
    )
  }

  try {
    const etags = await uploadParts(context, uploadId, partSize, partCount)

    await client.requestJson<RelayApiMultipartCompleteResponse>({
      method: 'POST',
      path: `/api/bundles/${bundleId}/files/${fileId}/multipart/complete`,
      accessToken,
      query: { workspaceId },
      body: {
        uploadId,
        parts: etags.map((etag, index) => ({ partNumber: index + 1, etag })),
      },
    })
  } catch (error) {
    await abortUpload(context, uploadId)
    throw error
  }
}

async function uploadParts(
  context: MultipartUploadContext,
  uploadId: string,
  partSize: number,
  partCount: number,
): Promise<string[]> {
  const { client, accessToken, workspaceId, bundleId, fileId, filePath } = context

  // Sign every part URL up front. R2 part URLs are valid for an hour, which is
  // enough for a single part on all but the slowest connections; a part that
  // still expires is transparently re-signed and retried below.
  const partNumbers = Array.from({ length: partCount }, (_, index) => index + 1)
  const signed = await client.requestJson<RelayApiMultipartPartsResponse>({
    method: 'POST',
    path: `/api/bundles/${bundleId}/files/${fileId}/multipart/parts`,
    accessToken,
    query: { workspaceId },
    body: { uploadId, partNumbers },
  })
  const urlByPart = new Map(signed.data.parts.map((part) => [part.partNumber, part.url]))

  const signOne = async (partNumber: number): Promise<string> => {
    const response = await client.requestJson<RelayApiMultipartPartsResponse>({
      method: 'POST',
      path: `/api/bundles/${bundleId}/files/${fileId}/multipart/parts`,
      accessToken,
      query: { workspaceId },
      body: { uploadId, partNumbers: [partNumber] },
    })
    const url = response.data.parts[0]?.url
    if (!url) {
      throw new CliError(`Server returned no presigned URL for part ${partNumber}`)
    }
    return url
  }

  const etags = new Array<string>(partCount)
  let nextPart = 1
  const concurrency = resolveConcurrency()

  const worker = async (): Promise<void> => {
    while (true) {
      const partNumber = nextPart++
      if (partNumber > partCount) return

      const etag = await uploadPartWithRetry({
        filePath,
        partNumber,
        partSize,
        initialUrl: urlByPart.get(partNumber),
        signOne,
      })
      etags[partNumber - 1] = etag
    }
  }

  const workerCount = Math.min(concurrency, partCount)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return etags
}

async function uploadPartWithRetry(options: {
  filePath: string
  partNumber: number
  partSize: number
  initialUrl?: string
  signOne: (partNumber: number) => Promise<string>
}): Promise<string> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt += 1) {
    try {
      const url = attempt === 0 ? options.initialUrl : await options.signOne(options.partNumber)
      if (!url) {
        throw new CliError(`No upload URL for part ${options.partNumber}`)
      }
      return await uploadSinglePart(options.filePath, options.partNumber, options.partSize, url)
    } catch (error) {
      lastError = error
      if (attempt >= MAX_PART_RETRIES || !isRetryableUploadError(error)) {
        throw error
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw lastError
}

async function uploadSinglePart(
  filePath: string,
  partNumber: number,
  partSize: number,
  url: string,
): Promise<string> {
  const fileStats = await fs.stat(filePath)
  const start = (partNumber - 1) * partSize
  const end = Math.min(start + partSize, fileStats.size) - 1
  const length = end - start + 1

  if (length <= 0) {
    throw new CliError(`Computed empty byte range for part ${partNumber}`)
  }

  // R2/S3 reject chunked part bodies (411 MissingContentLength), so declare
  // the exact byte length of this part explicitly, just like the single PUT.
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Length': String(length) },
    body: createReadStream(filePath, { start, end }),
    duplex: 'half',
  })

  if (!response.ok) {
    const message = await response.text()
    throw new CliError(
      `Upload part ${partNumber} failed with HTTP ${response.status}: ${message || url}`,
      { status: response.status },
    )
  }

  const etag = response.headers.get('etag')
  await response.text().catch(() => '')

  if (!etag) {
    throw new CliError(
      `Upload part ${partNumber} returned no ETag, which is required to finalize the multipart upload`,
    )
  }

  return etag
}

export function computePartCount(sizeBytes: number, partSize: number): number {
  if (!Number.isFinite(partSize) || partSize <= 0) {
    throw new CliError(`Invalid part size returned by the server: ${partSize}`)
  }
  return Math.max(1, Math.ceil(sizeBytes / partSize))
}

async function abortUpload(context: MultipartUploadContext, uploadId: string): Promise<void> {
  await context.client
    .requestJson({
      method: 'POST',
      path: `/api/bundles/${context.bundleId}/files/${context.fileId}/multipart/abort`,
      accessToken: context.accessToken,
      query: { workspaceId: context.workspaceId },
      body: { uploadId },
    })
    .catch(() => undefined)
}

function resolveConcurrency(): number {
  const raw = Number(process.env.RELAY_UPLOAD_CONCURRENCY ?? '')
  if (Number.isInteger(raw) && raw > 0) {
    return Math.min(raw, 16)
  }
  return DEFAULT_MAX_CONCURRENCY
}

export function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof CliError) {
    // 403 here most likely means an expired presigned URL — worth re-signing.
    // 408 / 429 / 5xx are transient. Other 4xx are permanent.
    if (error.status !== undefined) {
      return (
        error.status === 403 ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500
      )
    }
    return false
  }
  // Network errors (TypeError from fetch) are retryable.
  return error instanceof TypeError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
