#!/usr/bin/env bun
import { Command } from 'commander'
import { readCommand } from '@/commands/read'
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
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
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
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp table
const tableCmd = program.command('table').description('Work with tables')

// hwp table read <file> <ref>
tableCmd
  .command('read <file> <ref>')
  .description('Read table structure')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp table edit <file> <ref> <text>
tableCmd
  .command('edit <file> <ref> <text>')
  .description('Edit text in a table cell')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp table list <file>
tableCmd
  .command('list <file>')
  .description('List all tables in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp image
const imageCmd = program.command('image').description('Work with images')

// hwp image list <file>
imageCmd
  .command('list <file>')
  .description('List all images in the document')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp image extract <file> <ref> <output>
imageCmd
  .command('extract <file> <ref> <output>')
  .description('Extract an image to a file')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp image insert <file> <path>
imageCmd
  .command('insert <file> <path>')
  .description('Insert an image into the document')
  .option('--after <ref>', 'Insert after element at ref')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp image replace <file> <ref> <path>
imageCmd
  .command('replace <file> <ref> <path>')
  .description('Replace an existing image')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp create <file>
program
  .command('create <file>')
  .description('Create a new blank HWPX document')
  .option('--title <text>', 'Set initial paragraph text')
  .option('--font <name>', 'Set default font name', '맑은 고딕')
  .option('--size <pt>', 'Set default font size', '10')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

// hwp convert <input> <output>
program
  .command('convert <input> <output>')
  .description('Convert HWP 5.0 file to HWPX format')
  .option('--pretty', 'Pretty-print JSON output')
  .action(() => {
    console.log(JSON.stringify({ error: 'Not implemented' }))
    process.exit(1)
  })

program.parse(process.argv)
