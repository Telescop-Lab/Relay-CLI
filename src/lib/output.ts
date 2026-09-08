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
    const separator = '  '

    // Cap each column so a single oversized free-text value (e.g. a 500-char
    // note) cannot blow the whole layout off the screen.
    const naturalWidths = headers.map((header) => {
      const values = rows.map((row) => stringifyTableValue(row[header]))
      const longest = Math.max(header.length, ...values.map((value) => value.length))
      return Math.min(longest, MAX_COLUMN_WIDTH)
    })

    // On a TTY, shrink the widest columns (down to their header length) until
    // the table fits the terminal width, avoiding soft-wrap misalignment.
    let widths = naturalWidths
    const terminalWidth = this.availableColumns()
    if (terminalWidth) {
      const totalWidth =
        widths.reduce((sum, width) => sum + width, 0) + separator.length * (widths.length - 1)
      if (totalWidth > terminalWidth) {
        widths = shrinkToFit(widths, headers, terminalWidth, separator.length)
      }
    }

    const headerLine = headers
      .map((header, index) => truncateText(header, widths[index]).padEnd(widths[index]))
      .join(separator)
    const divider = widths.map((width) => '-'.repeat(width)).join(separator)

    this.writeLine(headerLine)
    this.writeLine(divider)

    for (const row of rows) {
      const line = headers
        .map((header, index) =>
          truncateText(stringifyTableValue(row[header]), widths[index]).padEnd(widths[index]),
        )
        .join(separator)
      this.writeLine(line)
    }
  }

  private availableColumns(): number | undefined {
    if (!process.stdout.isTTY) {
      return undefined
    }

    const columns = process.stdout.columns
    return typeof columns === 'number' && columns > 0 ? columns : undefined
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

const MAX_COLUMN_WIDTH = 40

function truncateText(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value
  }

  if (maxWidth <= 1) {
    return '…'
  }

  return `${value.slice(0, maxWidth - 1)}…`
}

function shrinkToFit(
  widths: number[],
  headers: string[],
  terminalWidth: number,
  separatorLength: number,
): number[] {
  const result = [...widths]
  const minWidths = headers.map((header) => header.length)

  const overflow = () =>
    result.reduce((sum, width) => sum + width, 0) + separatorLength * (result.length - 1) - terminalWidth

  while (overflow() > 0) {
    let shrinkIndex = -1
    let widest = -1

    for (let index = 0; index < result.length; index += 1) {
      if (result[index] > minWidths[index] && result[index] > widest) {
        widest = result[index]
        shrinkIndex = index
      }
    }

    if (shrinkIndex === -1) {
      break
    }

    result[shrinkIndex] -= 1
  }

  return result
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}