import { Command } from 'commander'

import { getCommandRuntime } from '../lib/runtime.js'

export function createConfigCommand() {
  const config = new Command('config')
    .description('Manage Relay CLI configuration')

  const set = new Command('set')
    .description('Set a Relay CLI configuration value')

  set
    .command('url <url>')
    .description('Set the Relay service URL')
    .action(async (url: string, _options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      const serviceUrl = runtime.config.setServiceUrl(url)

      if (runtime.options.json) {
        runtime.output.writeJson({ serviceUrl })
        return
      }

      runtime.output.writeLine(`Relay service URL set to ${serviceUrl}`)
    })

  config.addCommand(set)

  return config
}