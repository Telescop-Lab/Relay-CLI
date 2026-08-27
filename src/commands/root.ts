import { Command } from 'commander'

import { createConfigCommand } from './config.js'
import {
  createLoginCommand,
  createLogoutCommand,
  createSignupCommand,
  createWhoAmICommand,
} from './auth.js'
import { createDevicesCommand } from './devices.js'
import { createBundleCommand } from './bundles.js'
import { createExportCommand } from './export.js'
import { createFolderCommand } from './folders.js'
import { createHistoryCommand } from './history.js'
import { createStorageCommand } from './storage.js'
import { createWorkspaceCommand } from './workspaces.js'
import { createToolsCommand } from './tools.js'
import { getCommandRuntime } from '../lib/runtime.js'

type RootOptions = {
  json?: boolean
  debug?: boolean
  color?: boolean
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
    .option('--no-color', 'Disable ANSI color and style codes in output')
    .option('-V, --version', 'Display CLI version')
    .showSuggestionAfterError()
    .showHelpAfterError('(run with --help for usage)')

  program.configureOutput({
    outputError: () => {},
  })

  program
    .addCommand(createConfigCommand())
    .addCommand(createSignupCommand())
    .addCommand(createLoginCommand())
    .addCommand(createLogoutCommand())
    .addCommand(createWhoAmICommand())
    .addCommand(createDevicesCommand())
    .addCommand(createWorkspaceCommand())
    .addCommand(createFolderCommand())
    .addCommand(createBundleCommand())
    .addCommand(createHistoryCommand())
    .addCommand(createStorageCommand())
    .addCommand(createExportCommand())
    .addCommand(createToolsCommand(program, version))

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
      'Implemented now:',
      '  config set url',
      '  signup',
      '  login',
      '  logout',
      '  whoami',
      '  devices list',
      '  ws list/use/create/info/delete',
      '  ws message show/set',
      '  folder list',
      '  bundle inbox/list/show/pull/push/delete',
      '  history',
      '  storage stats',
      '  tools schema',
      '  export',
    ].join('\n'),
  )

  return program
}