import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * Compute the hex SHA-256 digest of a file by streaming it from disk, without
 * loading the whole file into memory. Returns a 64-character lowercase hex
 * string matching the server's `checksumSha256` format.
 */
export async function sha256FileHex(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

/**
 * Convert a 64-character hex SHA-256 digest into the base64 form that S3/R2
 * accepts in the `x-amz-checksum-sha256` header / `ChecksumSHA256` parameter.
 */
export function sha256HexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64')
}
