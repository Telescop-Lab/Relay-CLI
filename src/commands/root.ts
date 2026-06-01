import { Command } from 'commander'

import { getCommandRuntime } from '../lib/runtime.js'

type RootOptions = {
  json?: boolean
  debug?: boolean
  version?: boolean
}

export function createRootCommand(version: string) {
  const program = new Command()

  program
    .name('relay')
    .description('Relay CLI')
    .usage('[global options]')
    .helpOption('-h, --help', 'Display help information')
    .option('--json', 'Write structured results to stdout')
    .option('--debug', 'Print debug diagnostics to stderr')
    .option('-V, --version', 'Display CLI version')
    .showSuggestionAfterError()
    .showHelpAfterError('(run with --help for usage)')

  program.configureOutput({
    outputError: () => {},
  })

  program.action(async (_options, command: Command) => {
    const runtime = await getCommandRuntime(command)
    const options = command.optsWithGlobals() as RootOptions

    if (options.version) {
      runtime.output.writeVersion(version)
      return
    }

    command.outputHelp()
  })

  program.addHelpText(
    'after',
    [
      '',
      'Phase 1 and Phase 2 are wired in this build:',
      '  - single entrypoint and exit-code aware runtime',
      '  - --help / --version / --json / --debug globals',
      '  - config and credential stores',
      '  - HTTP transport and workspace resolution helpers',
      '  - output, prompt, path, glob, and folder-path utilities',
      '',
      'Business commands land in the next phases:',
      '  config, signup, login, logout, whoami, devices, ws, folder, bundle, history, storage, export',
    ].join('\n'),
  )

  return program
}