import { inspect } from 'node:util'

import chalk from 'chalk'

import type { CliError } from './errors.js'

type OutputOptions = {
  json: boolean
  debug: boolean
  color: boolean
}

type TableValue = string | number | boolean | null | undefined

export class CliOutput {
  constructor(private readonly options: OutputOptions) {
    if (!options.color) {
      chalk.level = 0
    }
  }

  writeLine(text = '') {
    process.stdout.write(`${text}\n`)
  }

  writeJson(value: unknown) {
    process.stdout.write(`${JSON.stringify(value, jsonReplacer, 2)}\n`)
  }

  writeVersion(version: string) {
    if (this.options.json) {
      this.writeJson({ version })
      return
    }

    this.writeLine(version)
  }

  writeTable(rows: Array<Record<string, TableValue>>) {
    if (rows.length === 0) {
      return
    }

    if (this.options.json) {
      this.writeJson(rows)
      return
    }

    const headers = Object.keys(rows[0])
    const widths = headers.map((header) => {
      const values = rows.map((row) => stringifyTableValue(row[header]))
      return Math.max(header.length, ...values.map((value) => value.length))
    })

    const headerLine = headers
      .map((header, index) => header.padEnd(widths[index]))
      .join('  ')
    const divider = widths.map((width) => '-'.repeat(width)).join('  ')

    this.writeLine(headerLine)
    this.writeLine(divider)

    for (const row of rows) {
      const line = headers
        .map((header, index) => stringifyTableValue(row[header]).padEnd(widths[index]))
        .join('  ')
      this.writeLine(line)
    }
  }

  writeList(items: string[]) {
    if (this.options.json) {
      this.writeJson(items)
      return
    }

    for (const item of items) {
      this.writeLine(item)
    }
  }

  warn(message: string) {
    const rendered = this.options.json
      ? JSON.stringify({ warning: message })
      : chalk.yellow(message)
    process.stderr.write(`${rendered}\n`)
  }

  debug(label: string, value: unknown) {
    if (!this.options.debug) {
      return
    }

    const payload = this.options.json
      ? JSON.stringify({ debug: label, value }, jsonReplacer, 2)
      : `${chalk.dim(label)} ${inspect(value, { depth: 6, colors: this.options.color && process.stderr.isTTY })}`

    process.stderr.write(`${payload}\n`)
  }

  renderError(error: CliError, options: { debug: boolean }) {
    if (this.options.json) {
      const payload: Record<string, unknown> = {
        error: {
          message: error.message,
          code: error.code,
          exitCode: error.exitCode,
        },
      }

      if (error.hint) {
        payload.error = {
          ...(payload.error as Record<string, unknown>),
          hint: error.hint,
        }
      }
      if (error.details !== undefined) {
        payload.error = {
          ...(payload.error as Record<string, unknown>),
          details: error.details,
        }
      }

      process.stderr.write(`${JSON.stringify(payload, jsonReplacer, 2)}\n`)
      return
    }

    process.stderr.write(`${chalk.red('Error:')} ${error.message}\n`)
    if (error.hint) {
      process.stderr.write(`${chalk.yellow('Hint:')} ${error.hint}\n`)
    }
    if (options.debug && error.details !== undefined) {
      process.stderr.write(`${inspect(error.details, { depth: 8, colors: this.options.color && process.stderr.isTTY })}\n`)
    }
    if (options.debug && error.cause instanceof Error) {
      process.stderr.write(`${inspect(error.cause, { depth: 8, colors: this.options.color && process.stderr.isTTY })}\n`)
    }
  }
}

function stringifyTableValue(value: TableValue) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}