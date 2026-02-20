import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { handleError } from '@/shared/error-handler'
import { formatOutput } from '@/shared/output'
import type { ParsedRef } from '@/shared/refs'
import { parseRef, validateRef } from '@/shared/refs'
import type { Image, Section } from '@/types'

export async function imageListCommand(file: string, options: { pretty?: boolean }): Promise<void> {
  try {
    validateExtension(file)
    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    const images = sections.flatMap((section) => section.images)
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
    validateExtension(file)
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
    validateExtension(file)
    const imageBuffer = await readFile(imagePath)
    const format = detectFormat(imagePath)
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
    validateExtension(file)
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

function validateExtension(file: string): void {
  const ext = file.split('.').pop()?.toLowerCase()
  if (ext !== 'hwpx') {
    throw new Error(`Unsupported file format: .${ext}`)
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

function detectFormat(imagePath: string): string {
  const ext = extname(imagePath).toLowerCase().slice(1)
  if (ext === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'gif'].includes(ext)) return ext
  throw new Error(`Unsupported image format: .${ext}`)
}
