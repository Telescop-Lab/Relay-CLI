/**
 * Run a worker over a list of items with bounded concurrency, preserving the
 * order of results. Used to upload multiple bundle files in parallel without
 * saturating the connection or object storage with too many simultaneous streams.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const results = new Array<R>(items.length)
  let nextIndex = 0

  const runner = async (): Promise<void> => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => runner()))
  return results
}

const DEFAULT_FILE_CONCURRENCY = 4
const MAX_FILE_CONCURRENCY = 8

/**
 * Resolve how many files to upload in parallel.
 *
 * Kept separate from the multipart part-level concurrency (`RELAY_UPLOAD_CONCURRENCY`)
 * so the two don't multiply into an excessive number of simultaneous streams.
 */
export function resolveFileConcurrency(): number {
  const raw = Number(process.env.RELAY_FILE_CONCURRENCY ?? '')
  if (Number.isInteger(raw) && raw > 0) {
    return Math.min(raw, MAX_FILE_CONCURRENCY)
  }
  return DEFAULT_FILE_CONCURRENCY
}
