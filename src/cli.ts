#!/usr/bin/env bun
import { Command } from 'commander'
import { convertCommand } from '@/commands/convert'
import { createCommand } from '@/commands/create'
import { editFormatCommand } from '@/commands/edit-format'
import { editTextCommand } from '@/commands/edit-text'
import { findCommand } from '@/commands/find'
import { imageExtractCommand, imageInsertCommand, imageListCommand, imageReplaceCommand } from '@/commands/image'
import { readCommand } from '@/commands/read'
import { tableEditCommand, tableListCommand, tableReadCommand } from '@/commands/table'
import { textCommand } from '@/commands/text'

const program = new Command()

program.name('hwpilot').description('HWP Copilot').version('0.1.0')

// hwpilot read <file> [ref]
program
  .command('read <file> [ref]')
  .description('Read document structure or a specific element')
  .option('--pretty', 'Pretty-print JSON output')
  .option('--offset <number>', 'Skip first N paragraphs (0-indexed)')
  .option('--limit <number>', 'Return at most N paragraphs')
  .action(
    async (file: string, ref: string | undefined, options: { pretty?: boolean; offset?: string; limit?: string }) => {
      await readCommand(file, ref, {
        pretty: options.pretty,
        offset: options.offset ? Number(options.offset) : undefined,
        limit: options.limit ? Number(options.limit) : undefined,
      })
    },
  )

// hwpilot text <file> [ref]
program
  .command('text <file> [ref]')
  .description('Extract text from document or a specific element')
  .option('--pretty', 'Pretty-print JSON output')
  .option('--offset <number>', 'Skip first N paragraphs (0-indexed)')
  .option('--limit <number>', 'Return at most N paragraphs')
  .action(
    async (file: string, ref: string | undefined, options: { pretty?: boolean; offset?: string; limit?: string }) => {
      await textCommand(file, ref, {
        pretty: options.pretty,
        offset: options.offset ? Number(options.offset) : undefined,
        limit: options.limit ? Number(options.limit) : undefined,
      })
    },
  )

// hwpilot find <file> <query>
program
  .command('find <file> <query>')
  .description('Search text in document and return matching refs')
  .option('--json', 'Output results as JSON')
  .action(async (file: string, query: string, options: { json?: boolean }) => {
    await findCommand(file, query, options)
  })

// hwpilot edit
const editCmd = program.command('edit').description('Edit document content')

// hwpilot edit text <file> <ref> <text>
editCmd
  .command('text <file> <ref> <text>')
  .description('Edit text at a specific reference')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, text: string, options: { pretty?: boolean }) => {
    await editTextCommand(file, ref, text, options)
  })

// hwpilot edit format <file> <ref>
editCmd
  .command('format <file> <ref>')
  .description('Edit character formatting at a specific reference')
  .option('--bold', 'Apply bold')
  .option('--no-bold', 'Remove bold')
  .option('--italic', 'Apply italic')
  .option('--no-italic', 'Remove italic')
  .option('--underline', 'Apply underline')
  .option('--no-underline', 'Remove underline')
  .option('--font <name>', 'Set font name')
  .option('--size <pt>', 'Set font size in points')
  .option('--color <hex>', 'Set text color (hex, e.g. #FF0000)')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, options: Record<string, unknown>) => {
    await editFormatCommand(file, ref, {
      bold: options.bold as boolean | undefined,
      italic: options.italic as boolean | undefined,
      underline: options.underline as boolean | undefined,
      font: options.font as string | undefined,
      size: options.size ? Number(options.size) : undefined,
      color: options.color as string | undefined,
      pretty: options.pretty as boolean | undefined,
    })
  })

// hwpilot table
const tableCmd = program.command('table').description('Work with tables')

// hwpilot table read <file> <ref>
tableCmd
  .command('read <file> <ref>')
  .description('Read table structure')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, options: { pretty?: boolean }) => {
    await tableReadCommand(file, ref, options)
  })

// hwpilot table edit <file> <ref> <text>
tableCmd
  .command('edit <file> <ref> <text>')
  .description('Edit text in a table cell')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, text: string, options: { pretty?: boolean }) => {
    await tableEditCommand(file, ref, text, options)
  })

// hwpilot table list <file>
tableCmd
  .command('list <file>')
  .description('List all tables in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { pretty?: boolean }) => {
    await tableListCommand(file, options)
  })

// hwpilot image
const imageCmd = program.command('image').description('Work with images')

// hwpilot image list <file>
imageCmd
  .command('list <file>')
  .description('List all images in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { pretty?: boolean }) => {
    await imageListCommand(file, options)
  })

// hwpilot image extract <file> <ref> <output>
imageCmd
  .command('extract <file> <ref> <output>')
  .description('Extract an image to a file')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, output: string, options: { pretty?: boolean }) => {
    await imageExtractCommand(file, ref, output, options)
  })

// hwpilot image insert <file> <path>
imageCmd
  .command('insert <file> <path>')
  .description('Insert an image into the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, path: string, options: { pretty?: boolean }) => {
    await imageInsertCommand(file, path, options)
  })

// hwpilot image replace <file> <ref> <path>
imageCmd
  .command('replace <file> <ref> <path>')
  .description('Replace an existing image')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, path: string, options: { pretty?: boolean }) => {
    await imageReplaceCommand(file, ref, path, options)
  })

// hwpilot create <file>
program
  .command('create <file>')
  .description('Create a new blank document')
  .option('--font <name>', 'Set default font name', '맑은 고딕')
  .option('--font <name>', 'Set default font name', '맑은 고딕')
  .option('--size <pt>', 'Set default font size', '10')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { font?: string; size?: string; pretty?: boolean }) => {
    await createCommand(file, options)
  })

// hwpilot convert <input> <output>
program
  .command('convert <input> <output>')
  .description('Convert HWP 5.0 file to HWPX format')
  .option('--pretty', 'Pretty-print JSON output')
  .option('--force', 'Overwrite existing output file')
  .action(async (input: string, output: string, options: { pretty?: boolean; force?: boolean }) => {
    await convertCommand(input, output, options)
  })

program.parse(process.argv)
