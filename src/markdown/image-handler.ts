import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import JSZip from 'jszip'
import type { Image } from '@/types'

export async function extractImages(
  inputPath: string,
  images: Image[],
  outputDir: string,
): Promise<Map<string, string>> {
  const data = await readFile(inputPath)
  const zip = await JSZip.loadAsync(data)
  const extractedPaths = new Map<string, string>()

  await mkdir(outputDir, { recursive: true })

  for (const image of images) {
    const file = zip.file(image.binDataPath)

    if (!file) {
      console.warn(`Image not found in archive: ${image.binDataPath}`)
      continue
    }

    const filename = basename(image.binDataPath)
    const outputPath = join(outputDir, filename)
    const bytes = await file.async('nodebuffer')

    await writeFile(outputPath, bytes)
    extractedPaths.set(image.binDataPath, filename)
  }

  return extractedPaths
}

export function resolveImagePaths(
  mdImages: Array<{ url: string; alt: string }>,
  baseDir: string,
): Array<{
  url: string
  alt: string
  resolvedPath: string | null
  warning?: string
}> {
  return mdImages.map((image) => {
    if (image.url.startsWith('http://') || image.url.startsWith('https://')) {
      return {
        ...image,
        resolvedPath: null,
        warning: 'Remote URLs not supported',
      }
    }

    const resolvedPath = isAbsolute(image.url)
      ? image.url
      : resolve(baseDir, image.url)

    if (!existsSync(resolvedPath)) {
      return {
        ...image,
        resolvedPath: null,
        warning: `File not found: ${resolvedPath}`,
      }
    }

    return {
      ...image,
      resolvedPath,
    }
  })
}

export async function embedImage(
  zip: JSZip,
  localPath: string,
  index: number,
): Promise<Image> {
  const bytes = await readFile(localPath)
  const format = normalizeImageFormat(extname(localPath))
  const binDataPath = `BinData/image${index}.${format}`

  zip.file(binDataPath, bytes)

  return {
    ref: `s0.img${index}`,
    binDataPath,
    width: 0,
    height: 0,
    format,
  }
}

function normalizeImageFormat(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.jpeg':
    case '.jpg':
      return 'jpg'
    case '.png':
      return 'png'
    case '.gif':
      return 'gif'
    case '.bmp':
      return 'bmp'
    default:
      throw new Error(`Unsupported image format: ${extension}`)
  }
}
