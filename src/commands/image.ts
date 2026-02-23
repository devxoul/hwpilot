import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { listImages } from '@/shared/document-ops'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import type { ParsedRef } from '@/shared/refs'
import { parseRef, validateRef } from '@/shared/refs'
import type { Image, Section } from '@/types'

export async function imageListCommand(file: string, options: { pretty?: boolean }): Promise<void> {
  try {
    const format = await detectFormat(file)
    let sections: Section[]

    if (format === 'hwp') {
      const doc = await loadHwp(file)
      sections = doc.sections
    } else {
      const archive = await loadHwpx(file)
      sections = await parseSections(archive)
    }

    const images = listImages(sections)
    console.log(formatOutput(images, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

export async function imageExtractCommand(
  file: string,
  ref: string,
  outputPath: string,
  options: { pretty?: boolean },
): Promise<void> {
  try {
    await validateHwpxFormat(file)
    const parsed = validateImageRef(ref)
    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    const image = getImage(sections, parsed, ref)
    const data = await archive.getBinData(image.binDataPath)
    await writeFile(outputPath, data)
    console.log(formatOutput({ ref: image.ref, outputPath, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

export async function imageInsertCommand(
  file: string,
  imagePath: string,
  options: { pretty?: boolean },
): Promise<void> {
  try {
    await validateHwpxFormat(file)
    const imageBuffer = await readFile(imagePath)
    const format = detectImageFormat(imagePath)
    const archive = await loadHwpx(file)
    const zip = archive.getZip()
    const existingCount = archive.listBinData().length
    const newBinDataPath = `BinData/image${existingCount}.${format}`
    zip.file(newBinDataPath, imageBuffer)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(file, buffer)
    console.log(formatOutput({ binDataPath: newBinDataPath, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

export async function imageReplaceCommand(
  file: string,
  ref: string,
  imagePath: string,
  options: { pretty?: boolean },
): Promise<void> {
  try {
    await validateHwpxFormat(file)
    const parsed = validateImageRef(ref)
    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    const image = getImage(sections, parsed, ref)
    const newImageBuffer = await readFile(imagePath)
    const zip = archive.getZip()
    zip.file(image.binDataPath, newImageBuffer)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(file, buffer)
    console.log(formatOutput({ ref: image.ref, binDataPath: image.binDataPath, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

async function validateHwpxFormat(file: string): Promise<void> {
  const format = await detectFormat(file)
  if (format !== 'hwpx') {
    throw new Error(
      'Image insert/replace/extract requires HWPX format. Convert with: hwp convert <file.hwp> <file.hwpx>',
    )
  }
}

function validateImageRef(ref: string): ParsedRef {
  if (!validateRef(ref)) {
    throw new Error(`Invalid reference: ${ref}`)
  }
  const parsed = parseRef(ref)
  if (parsed.image === undefined) {
    throw new Error(`Not an image reference: ${ref}`)
  }
  return parsed
}

function getImage(sections: Section[], parsed: ParsedRef, ref: string): Image {
  const section = sections[parsed.section]
  if (!section) {
    throw new Error(`Section ${parsed.section} not found`)
  }
  const image = section.images[parsed.image!]
  if (!image) {
    throw new Error(`Image ${ref} not found`)
  }
  return image
}

function detectImageFormat(imagePath: string): string {
  const ext = extname(imagePath).toLowerCase().slice(1)
  if (ext === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'gif'].includes(ext)) return ext
  throw new Error(`Unsupported image format: .${ext}`)
}
