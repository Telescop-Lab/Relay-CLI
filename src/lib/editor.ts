import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { CliError } from './errors.js'

export async function editTextInEditor(initialContent = '') {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError('No interactive editor is available in this terminal', {
      code: 'EDITOR_ERROR',
      hint: 'Use --file or --stdin in non-interactive mode.',
    })
  }

  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || defaultEditor()
  const tempFilePath = path.join(os.tmpdir(), `relay-workspace-message-${Date.now()}.txt`)

  await fs.writeFile(tempFilePath, initialContent, 'utf8')

  try {
    const result = spawnSync(editor, [tempFilePath], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    if (result.error) {
      throw new CliError(`Failed to launch editor: ${editor}`, {
        code: 'EDITOR_ERROR',
        cause: result.error,
      })
    }

    if ((result.status ?? 0) !== 0) {
      throw new CliError(`Editor exited with status ${result.status ?? 1}`, {
        code: 'EDITOR_ERROR',
      })
    }

    return await fs.readFile(tempFilePath, 'utf8')
  } finally {
    await fs.unlink(tempFilePath).catch(() => undefined)
  }
}

function defaultEditor() {
  return process.platform === 'win32' ? 'notepad' : 'vi'
}