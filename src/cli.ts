#!/usr/bin/env bun
import { Command } from 'commander'
import { convertCommand } from '@/commands/convert'
import { createCommand } from '@/commands/create'
import { editFormatCommand } from '@/commands/edit-format'
import { editTextCommand } from '@/commands/edit-text'
import { imageExtractCommand, imageInsertCommand, imageListCommand, imageReplaceCommand } from '@/commands/image'
import { readCommand } from '@/commands/read'
import { tableEditCommand, tableListCommand, tableReadCommand } from '@/commands/table'
import { textCommand } from '@/commands/text'

const program = new Command()

program.name('hwp').description('Native HWP/HWPX document editor CLI for AI agents').version('0.1.0')

// hwp read <file> [ref]
program
  .command('read <file> [ref]')
  .description('Read document structure or a specific element')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string | undefined, options: { pretty?: boolean }) => {
    await readCommand(file, ref, options)
  })

// hwp text <file> [ref]
program
  .command('text <file> [ref]')
  .description('Extract text from document or a specific element')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string | undefined, options: { pretty?: boolean }) => {
    await textCommand(file, ref, options)
  })

// hwp edit
const editCmd = program.command('edit').description('Edit document content')

// hwp edit text <file> <ref> <text>
editCmd
  .command('text <file> <ref> <text>')
  .description('Edit text at a specific reference')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, text: string, options: { pretty?: boolean }) => {
    await editTextCommand(file, ref, text, options)
  })

// hwp edit format <file> <ref>
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

// hwp table
const tableCmd = program.command('table').description('Work with tables')

// hwp table read <file> <ref>
tableCmd
  .command('read <file> <ref>')
  .description('Read table structure')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, options: { pretty?: boolean }) => {
    await tableReadCommand(file, ref, options)
  })

// hwp table edit <file> <ref> <text>
tableCmd
  .command('edit <file> <ref> <text>')
  .description('Edit text in a table cell')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, text: string, options: { pretty?: boolean }) => {
    await tableEditCommand(file, ref, text, options)
  })

// hwp table list <file>
tableCmd
  .command('list <file>')
  .description('List all tables in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { pretty?: boolean }) => {
    await tableListCommand(file, options)
  })

// hwp image
const imageCmd = program.command('image').description('Work with images')

// hwp image list <file>
imageCmd
  .command('list <file>')
  .description('List all images in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { pretty?: boolean }) => {
    await imageListCommand(file, options)
  })

// hwp image extract <file> <ref> <output>
imageCmd
  .command('extract <file> <ref> <output>')
  .description('Extract an image to a file')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, output: string, options: { pretty?: boolean }) => {
    await imageExtractCommand(file, ref, output, options)
  })

// hwp image insert <file> <path>
imageCmd
  .command('insert <file> <path>')
  .description('Insert an image into the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, path: string, options: { pretty?: boolean }) => {
    await imageInsertCommand(file, path, options)
  })

// hwp image replace <file> <ref> <path>
imageCmd
  .command('replace <file> <ref> <path>')
  .description('Replace an existing image')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, ref: string, path: string, options: { pretty?: boolean }) => {
    await imageReplaceCommand(file, ref, path, options)
  })

// hwp create <file>
program
  .command('create <file>')
  .description('Create a new blank HWPX document')
  .option('--title <text>', 'Set initial paragraph text')
  .option('--font <name>', 'Set default font name', '맑은 고딕')
  .option('--size <pt>', 'Set default font size', '10')
  .option('--pretty', 'Pretty-print JSON output')
  .action(async (file: string, options: { title?: string; font?: string; size?: string; pretty?: boolean }) => {
    await createCommand(file, options)
  })

// hwp convert <input> <output>
program
  .command('convert <input> <output>')
  .description('Convert HWP 5.0 file to HWPX format')
  .option('--pretty', 'Pretty-print JSON output')
  .option('--force', 'Overwrite existing output file')
  .action(async (input: string, output: string, options: { pretty?: boolean; force?: boolean }) => {
    await convertCommand(input, output, options)
  })

program.parse(process.argv)
