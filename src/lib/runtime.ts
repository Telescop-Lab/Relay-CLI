import type { Command } from 'commander'
import ora from 'ora'

import { ConfigStore } from './config-store.js'
import { CredentialStore } from './credential-store.js'
import { CliOutput } from './output.js'

const runtimeSymbol = Symbol('relay.cli.runtime')

export type GlobalOptions = {
  json: boolean
  debug: boolean
  version: boolean
}

export type CliRuntime = {
  cwd: string
  options: GlobalOptions
  output: CliOutput
  config: ConfigStore
  credentials: CredentialStore
  createSpinner: (text?: string) => ReturnType<typeof ora>
}

export async function createRuntime(options: Partial<GlobalOptions>) {
  const resolvedOptions: GlobalOptions = {
    json: Boolean(options.json),
    debug: Boolean(options.debug),
    version: Boolean(options.version),
  }

  const output = new CliOutput({
    json: resolvedOptions.json,
    debug: resolvedOptions.debug,
  })

  return {
    cwd: process.cwd(),
    options: resolvedOptions,
    output,
    config: new ConfigStore(),
    credentials: new CredentialStore(),
    createSpinner: (text = '') =>
      ora({
        text,
        stream: process.stderr,
        isEnabled: !resolvedOptions.json && process.stderr.isTTY,
      }),
  } satisfies CliRuntime
}

export async function getCommandRuntime(command: Command) {
  const cached = Reflect.get(command, runtimeSymbol) as CliRuntime | undefined
  if (cached) {
    return cached
  }

  const runtime = await createRuntime(resolveGlobalOptions(command))
  Reflect.set(command, runtimeSymbol, runtime)
  return runtime
}

export function readGlobalOptionsFromArgv(argv: string[]) {
  return {
    json: argv.includes('--json'),
    debug: argv.includes('--debug'),
    version: argv.includes('--version') || argv.includes('-V'),
  }
}

function resolveGlobalOptions(command: Command): Partial<GlobalOptions> {
  const options = command.optsWithGlobals() as Partial<GlobalOptions>
  return {
    json: Boolean(options.json),
    debug: Boolean(options.debug),
    version: Boolean(options.version),
  }
}