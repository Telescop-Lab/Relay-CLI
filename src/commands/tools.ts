import { Command } from 'commander'

import { getCommandRuntime } from '../lib/runtime.js'
import { buildCommandSchema } from '../lib/schema.js'

export function createToolsCommand(program: Command, version: string) {
  const tools = new Command('tools')
    .description('Introspect Relay CLI capabilities for agents and scripts')

  tools
    .command('schema')
    .description('Emit a machine-readable JSON schema of every Relay CLI command')
    .action(async (_options: unknown, command: Command) => {
      const runtime = await getCommandRuntime(command)
      runtime.output.writeJson(buildCommandSchema(program, version))
    })

  return tools
}
