import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'

import { CliError } from './errors.js'

export async function promptText(message: string) {
  ensureInteractive()

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    return (await rl.question(`${message}: `)).trim()
  } finally {
    rl.close()
  }
}

export async function confirm(message: string, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] '
  const answer = (await promptText(`${message}${suffix}`)).toLowerCase()

  if (!answer) {
    return defaultValue
  }

  return answer === 'y' || answer === 'yes'
}

export async function readPassword(message: string, confirmPassword = false) {
  ensureInteractive()

  const first = await promptHidden(message)
  if (!confirmPassword) {
    return first
  }

  const second = await promptHidden('Confirm password')
  if (first !== second) {
    throw new CliError('Password confirmation did not match')
  }

  return first
}

export async function readStdin() {
  if (process.stdin.isTTY) {
    throw new CliError('Standard input is empty', {
      hint: 'Pipe content into stdin before using this mode.',
    })
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function ensureInteractive() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError('This command requires an interactive terminal')
  }
}

async function promptHidden(message: string) {
  const maskedOutput = new HiddenOutput(process.stderr)
  const rl = createInterface({
    input: process.stdin,
    output: maskedOutput,
    terminal: true,
  })

  try {
    maskedOutput.muted = true
    const answer = await rl.question(`${message}: `)
    process.stderr.write('\n')
    return answer
  } finally {
    maskedOutput.muted = false
    rl.close()
  }
}

class HiddenOutput extends Writable {
  muted = false

  constructor(private readonly target: NodeJS.WriteStream) {
    super()
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (!this.muted) {
      this.target.write(chunk, encoding)
    }
    callback()
  }
}