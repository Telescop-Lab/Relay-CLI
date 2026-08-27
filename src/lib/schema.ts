import type { Argument, Command, Option } from 'commander'

export type SchemaArgument = {
  name: string
  required: boolean
  variadic: boolean
  description: string
  defaultValue?: unknown
}

export type SchemaOption = {
  flags: string
  short?: string
  long?: string
  description: string
  /** The option must be specified on the command line (requiredOption). */
  required: boolean
  /** The flag requires a value when present, e.g. `--foo <value>`. */
  valueRequired: boolean
  /** The flag's value is optional when present, e.g. `--foo [value]`. */
  valueOptional: boolean
  negate: boolean
  defaultValue?: unknown
  choices?: string[]
}

export type SchemaCommand = {
  name: string
  description: string
  arguments: SchemaArgument[]
  options: SchemaOption[]
}

export type CommandSchema = {
  name: string
  version: string
  description: string
  globalOptions: SchemaOption[]
  commands: SchemaCommand[]
}

/**
 * Walk a Commander program and produce a machine-readable description of every
 * invokable command, its arguments, and its options. This is the "tool
 * discovery" surface an agent uses to learn the Relay CLI in a single call.
 */
export function buildCommandSchema(program: Command, version: string): CommandSchema {
  const commands: SchemaCommand[] = []

  for (const subcommand of program.commands) {
    walkCommand(subcommand, '', commands)
  }

  return {
    name: program.name(),
    version,
    description: program.description(),
    globalOptions: program.options.map(describeOption),
    commands,
  }
}

function walkCommand(command: Command, parentPath: string, output: SchemaCommand[]) {
  const name = command.name()
  const fullName = parentPath ? `${parentPath} ${name}` : name

  output.push(describeCommand(command, fullName))

  for (const subcommand of command.commands) {
    walkCommand(subcommand, fullName, output)
  }
}

function describeCommand(command: Command, fullName: string): SchemaCommand {
  return {
    name: fullName,
    description: command.description() || command.summary() || '',
    arguments: command.registeredArguments.map(describeArgument),
    options: command.options.map(describeOption),
  }
}

function describeArgument(argument: Argument): SchemaArgument {
  const schema: SchemaArgument = {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description ?? '',
  }

  if (argument.defaultValue !== undefined) {
    schema.defaultValue = argument.defaultValue
  }

  return schema
}

function describeOption(option: Option): SchemaOption {
  const schema: SchemaOption = {
    flags: option.flags,
    description: option.description ?? '',
    required: option.mandatory,
    valueRequired: option.required,
    valueOptional: option.optional,
    negate: option.negate,
  }

  if (option.short) {
    schema.short = option.short
  }
  if (option.long) {
    schema.long = option.long
  }
  if (option.defaultValue !== undefined) {
    schema.defaultValue = option.defaultValue
  }
  if (option.argChoices && option.argChoices.length > 0) {
    schema.choices = [...option.argChoices]
  }

  return schema
}
