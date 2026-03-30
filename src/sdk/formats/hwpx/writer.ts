import { type EditOperation, type FormatOptions, type XmlNode } from '@/sdk/edit-types'

import { loadHwpx } from './loader'
import { mutateHwpxZip } from './mutator'

export type { EditOperation, FormatOptions, XmlNode }

export async function editHwpx(fileBuffer: Uint8Array, operations: EditOperation[]): Promise<Uint8Array> {
  if (operations.length === 0) {
    return fileBuffer
  }

  const archive = await loadHwpx(fileBuffer)
  const zip = archive.getZip()

  await mutateHwpxZip(zip, archive, operations)

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  return new Uint8Array(buffer)
}
