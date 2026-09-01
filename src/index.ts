#!/usr/bin/env node

import { createRootCommand } from './commands/root.js'
import {
  isCommanderHelpDisplay,
  toCliError,
} from './lib/errors.js'
import { createRuntime, readGlobalOptionsFromArgv } from './lib/runtime.js'

async function main() {
  const version = process.env.RELAY_CLI_VERSION ?? '0.0.0'
  const program = createRootCommand(version)
  program.exitOverride()

  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (isCommanderHelpDisplay(error)) {
      process.exit(0)
    }

    const runtime = await createRuntime(readGlobalOptionsFromArgv(process.argv.slice(2)))
    // toCliError preserves CliError instances verbatim (including hint/details),
    // then falls back to CommanderError translation only for real Commander errors.
    const cliError = toCliError(error)

    runtime.output.renderError(cliError, { debug: runtime.options.debug })
    process.exit(cliError.exitCode)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})