import { writeFile } from 'node:fs/promises'
import { type EditOperation, type FormatOptions, type XmlNode } from '@/shared/edit-types'
import { loadHwpx } from './loader'
import { mutateHwpxZip } from './mutator'

export type { EditOperation, FormatOptions, XmlNode }

export async function editHwpx(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const archive = await loadHwpx(filePath)
  const zip = archive.getZip()

  await mutateHwpxZip(zip, archive, operations)

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(filePath, buffer)
}
