#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRootCommand } from './commands/root.js'
import {
  commanderErrorToCliError,
  isCommanderError,
  isCommanderHelpDisplay,
  toCliError,
} from './lib/errors.js'
import { createRuntime, readGlobalOptionsFromArgv } from './lib/runtime.js'

async function readPackageVersion() {
  const currentFile = fileURLToPath(import.meta.url)
  const packageJsonPath = path.resolve(path.dirname(currentFile), '../package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    version?: string
  }

  return packageJson.version ?? '0.0.0'
}

async function main() {
  const version = await readPackageVersion()
  const program = createRootCommand(version)
  program.exitOverride()

  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (isCommanderHelpDisplay(error)) {
      process.exit(0)
    }

    const runtime = await createRuntime(readGlobalOptionsFromArgv(process.argv.slice(2)))
    const cliError = isCommanderError(error)
      ? commanderErrorToCliError(error)
      : toCliError(error)

    runtime.output.renderError(cliError, { debug: runtime.options.debug })
    process.exit(cliError.exitCode)
  }
}

await main()