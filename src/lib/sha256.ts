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
