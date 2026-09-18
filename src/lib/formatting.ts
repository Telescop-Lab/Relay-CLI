export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return '-'
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function timestampForFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

export function sanitizeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'relay'
}

export function describeHistoryType(type: string) {
  switch (type) {
    case 'BUNDLE_CREATED':
      return 'bundle created'
    case 'BUNDLE_FINALIZED':
      return 'bundle finalized'
    case 'BUNDLE_DELETED':
      return 'bundle deleted'
    case 'FILES_DOWNLOADED':
      return 'bundle downloaded'
    case 'FOLDER_CREATED':
      return 'folder created'
    case 'FOLDER_DELETED':
      return 'folder deleted'
    case 'WORKSPACE_UPDATED':
      return 'workspace updated'
    case 'WORKSPACE_MESSAGE_UPDATED':
      return 'workspace_message updated'
    default:
      return type.toLowerCase().replace(/_/g, ' ')
  }
}