import { Command } from 'commander'

import { getCommandRuntime } from '../lib/runtime.js'
import { normalizeProfileName } from '../lib/config-store.js'

export function createConfigCommand() {
  const config = new Command('config')
    .description('Manage Relay CLI configuration')

  const set = new Command('set')
    .description('Set a Relay CLI configuration value')

  set
    .command('url <url>')
    .description('Set the Relay service URL for the active profile')
    .option('--profile <name>', 'Profile to configure instead of the active profile')
    .action(async (url: string, options: { profile?: string }, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const profile = options.profile ? normalizeProfileName(options.profile) : runtime.profile
      const serviceUrl = runtime.config.setServiceUrl(url, profile)

      if (runtime.options.json) {
        runtime.output.writeJson({ profile, serviceUrl })
        return
      }

      runtime.output.writeLine(`Relay service URL set to ${serviceUrl} (profile: ${profile})`)
    })

  config.addCommand(set)

  config.addCommand(createProfileCommand())

  return config
}

export function createProfileCommand() {
  const profile = new Command('profile')
    .description('Manage named Relay profiles (each holds its own service URL and session)')

  profile
    .command('list')
    .description('List all configured profiles')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const profiles = runtime.config.listProfiles()

      if (runtime.options.json) {
        runtime.output.writeJson(profiles)
        return
      }

      if (profiles.length === 0) {
        runtime.output.writeLine('No profiles configured.')
        return
      }

      runtime.output.writeTable(
        profiles.map((item) => ({
          current: item.current ? '*' : '',
          name: item.name,
          serviceUrl: item.serviceUrl ?? '(unset)',
          defaultWorkspace: item.defaultWorkspace ?? '',
        })),
      )
    })

  profile
    .command('use <name>')
    .description('Set the active profile')
    .action(async (name: string, _options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const active = runtime.config.setCurrentProfile(name)

      if (runtime.options.json) {
        runtime.output.writeJson({ profile: active })
        return
      }

      runtime.output.writeLine(`Active profile set to ${active}`)
    })

  profile
    .command('remove <name>')
    .description('Remove a profile (cannot remove the active profile)')
    .action(async (name: string, _options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      runtime.config.removeProfile(name)

      if (runtime.options.json) {
        runtime.output.writeJson({ success: true, profile: normalizeProfileName(name) })
        return
      }

      runtime.output.writeLine(`Removed profile ${normalizeProfileName(name)}`)
    })

  return profile
}
