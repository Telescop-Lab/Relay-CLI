import type { Command } from 'commander'
import ora from 'ora'

import { ConfigStore } from './config-store.js'
import { CredentialStore } from './credential-store.js'
import { CliOutput } from './output.js'
import { DEFAULT_PROFILE, RELAY_PROFILE_ENV } from './constants.js'

const runtimeSymbol = Symbol('relay.cli.runtime')

export type GlobalOptions = {
  json: boolean
  debug: boolean
  version: boolean
  color: boolean
  profile?: string
}

export type CliRuntime = {
  cwd: string
  profile: string
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
    color: options.color !== false,
    profile: options.profile,
  }

  const output = new CliOutput({
    json: resolvedOptions.json,
    debug: resolvedOptions.debug,
    color: resolvedOptions.color,
  })

  const config = new ConfigStore()
  const profile = resolveActiveProfile(resolvedOptions.profile, config.getCurrentProfile())
  config.setActiveProfile(profile)

  return {
    cwd: process.cwd(),
    profile,
    options: resolvedOptions,
    output,
    config,
    credentials: new CredentialStore(),
    createSpinner: (text = '') =>
      ora({
        text,
        stream: process.stderr,
        isEnabled: !resolvedOptions.json && resolvedOptions.color && process.stderr.isTTY,
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
    color: !argv.includes('--no-color'),
    profile: readProfileFromArgv(argv),
  }
}

function resolveGlobalOptions(command: Command): Partial<GlobalOptions> {
  const options = command.optsWithGlobals() as Partial<GlobalOptions>
  return {
    json: Boolean(options.json),
    debug: Boolean(options.debug),
    version: Boolean(options.version),
    color: options.color !== false,
    profile: options.profile,
  }
}

function resolveActiveProfile(explicitProfile: string | undefined, configuredProfile: string) {
  const value = (explicitProfile ?? process.env[RELAY_PROFILE_ENV] ?? configuredProfile ?? DEFAULT_PROFILE).trim()
  return value || DEFAULT_PROFILE
}

function readProfileFromArgv(argv: string[]) {
  const index = argv.indexOf('--profile')
  if (index !== -1 && index + 1 < argv.length) {
    return argv[index + 1]
  }

  const inline = argv.find((arg) => arg.startsWith('--profile='))
  if (inline) {
    return inline.slice('--profile='.length)
  }

  return undefined
}