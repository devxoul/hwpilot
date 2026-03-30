import { writeFile } from 'node:fs/promises'

import { createHwp } from '@/formats/hwp/creator'
import { createHwpx } from '@/sdk/formats/hwpx/creator'
import { handleError } from '@/cli/error-handler'
import { formatOutput } from '@/cli/output'

type CreateOptions = {
  font?: string
  size?: string
  pretty?: boolean
}

function parseSize(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid font size: ${raw}`)
  return n
}

export async function createCommand(file: string, options: CreateOptions): Promise<void> {
  try {
    const ext = file.split('.').pop()?.toLowerCase()
    const fontSize = options.size ? parseSize(options.size) : undefined

    if (ext === 'hwp') {
      const buffer = await createHwp({ font: options.font, fontSize })
      await writeFile(file, buffer, { flag: 'wx' })
      console.log(formatOutput({ file, success: true }, options.pretty))
      return
    }

    if (ext !== 'hwpx') {
      throw new Error(`Unsupported file format: .${ext}`)
    }

    const buffer = await createHwpx({ font: options.font, fontSize })
    await writeFile(file, buffer, { flag: 'wx' })

    console.log(formatOutput({ file, success: true }, options.pretty))
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'EEXIST') {
      handleError(new Error(`File already exists: ${file}`))
      return
    }
    handleError(e)
  }
}
