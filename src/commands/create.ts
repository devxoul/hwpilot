import { access, writeFile } from 'node:fs/promises'
import { handleError } from '@/shared/error-handler'
import { formatOutput } from '@/shared/output'
import { createTestHwpx } from '@/test-helpers'
import { createHwp } from '@/formats/hwp/creator'

type CreateOptions = {
  title?: string
  font?: string
  size?: string
  pretty?: boolean
}

export async function createCommand(file: string, options: CreateOptions): Promise<void> {
  try {
    const ext = file.split('.').pop()?.toLowerCase()

    if (ext === 'hwp') {
      try {
        await access(file)
        throw new Error(`File already exists: ${file}`)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('File already exists')) throw e
      }
      const paragraphs = options.title ? [options.title] : ['']
      const fontSize = options.size ? Number(options.size) * 100 : undefined
      const buffer = await createHwp({ paragraphs, font: options.font, fontSize })
      await writeFile(file, buffer)
      console.log(formatOutput({ file, success: true }, options.pretty))
      return
    }

    if (ext !== 'hwpx') {
      throw new Error(`Unsupported file format: .${ext}`)
    }

    try {
      await access(file)
      throw new Error(`File already exists: ${file}`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('File already exists')) throw e
    }

    const paragraphs = options.title ? [options.title] : ['']
    const font = options.font
    const fontSize = options.size ? Number(options.size) * 100 : undefined
    const buffer = await createTestHwpx({ paragraphs, font, fontSize })

    await writeFile(file, buffer)

    console.log(formatOutput({ file, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}
