import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { Image } from '@/types'
import { embedImage, extractImages, resolveImagePaths } from './image-handler'

const PNG_BYTES = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
])

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

let testDir = ''

beforeAll(async () => {
  testDir = join(tmpdir(), `image-handler-${Date.now()}`)
  await mkdir(testDir, { recursive: true })
})

afterAll(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true })
  }
})

describe('resolveImagePaths', () => {
  it('resolves relative path correctly against baseDir', async () => {
    const baseDir = join(testDir, 'resolve-relative')
    const imagePath = join(baseDir, 'assets', 'photo.png')
    await mkdir(join(baseDir, 'assets'), { recursive: true })
    await writeFile(imagePath, PNG_BYTES)

    const [result] = resolveImagePaths(
      [{ url: 'assets/photo.png', alt: 'photo' }],
      baseDir,
    )

    expect(result).toEqual({
      url: 'assets/photo.png',
      alt: 'photo',
      resolvedPath: imagePath,
    })
  })

  it('returns absolute path as-is when file exists', async () => {
    const imagePath = join(testDir, 'absolute.png')
    await writeFile(imagePath, PNG_BYTES)

    const [result] = resolveImagePaths([{ url: imagePath, alt: 'abs' }], testDir)

    expect(result).toEqual({
      url: imagePath,
      alt: 'abs',
      resolvedPath: imagePath,
    })
  })

  it('returns warning for remote URLs', () => {
    const [result] = resolveImagePaths(
      [{ url: 'https://example.com/image.png', alt: 'remote' }],
      testDir,
    )

    expect(result.resolvedPath).toBeNull()
    expect(result.warning).toContain('Remote')
  })

  it('returns warning for missing local files', () => {
    const missingPath = join(testDir, 'missing.png')
    const [result] = resolveImagePaths([{ url: 'missing.png', alt: 'missing' }], testDir)

    expect(result.resolvedPath).toBeNull()
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain(missingPath)
  })

  it('resolves multiple images in one call', async () => {
    const baseDir = join(testDir, 'resolve-multiple')
    const relativePath = join(baseDir, 'relative.png')
    const absolutePath = join(testDir, 'absolute-multiple.png')
    await mkdir(baseDir, { recursive: true })
    await writeFile(relativePath, PNG_BYTES)
    await writeFile(absolutePath, PNG_BYTES)

    const results = resolveImagePaths(
      [
        { url: 'relative.png', alt: 'relative' },
        { url: absolutePath, alt: 'absolute' },
      ],
      baseDir,
    )

    expect(results).toEqual([
      { url: 'relative.png', alt: 'relative', resolvedPath: relativePath },
      { url: absolutePath, alt: 'absolute', resolvedPath: absolutePath },
    ])
  })
})

describe('embedImage', () => {
  it('embeds PNG file into ZIP at BinData/image0.png', async () => {
    const imagePath = join(testDir, 'embed-0.png')
    await writeFile(imagePath, PNG_BYTES)
    const zip = new JSZip()

    await embedImage(zip, imagePath, 0)

    expect(zip.file('BinData/image0.png')).not.toBeNull()
  })

  it('returns Image with ref s0.img0 and format png', async () => {
    const imagePath = join(testDir, 'embed-meta.png')
    await writeFile(imagePath, PNG_BYTES)
    const zip = new JSZip()

    const result = await embedImage(zip, imagePath, 0)

    expect(result).toEqual({
      ref: 's0.img0',
      binDataPath: 'BinData/image0.png',
      width: 0,
      height: 0,
      format: 'png',
    })
  })

  it('uses index 1 for BinData/image1.png and s0.img1', async () => {
    const imagePath = join(testDir, 'embed-1.png')
    await writeFile(imagePath, PNG_BYTES)
    const zip = new JSZip()

    const result = await embedImage(zip, imagePath, 1)

    expect(zip.file('BinData/image1.png')).not.toBeNull()
    expect(result.ref).toBe('s0.img1')
    expect(result.binDataPath).toBe('BinData/image1.png')
  })

  it('normalizes .jpeg extension to jpg format', async () => {
    const imagePath = join(testDir, 'embed-jpeg.jpeg')
    await writeFile(imagePath, JPEG_BYTES)
    const zip = new JSZip()

    const result = await embedImage(zip, imagePath, 2)

    expect(result.format).toBe('jpg')
    expect(result.binDataPath).toBe('BinData/image2.jpg')
    expect(zip.file('BinData/image2.jpg')).not.toBeNull()
  })

  it('adds actual file bytes to the zip entry', async () => {
    const imagePath = join(testDir, 'embed-bytes.png')
    await writeFile(imagePath, PNG_BYTES)
    const zip = new JSZip()

    await embedImage(zip, imagePath, 0)

    const file = zip.file('BinData/image0.png')
    expect(file).not.toBeNull()
    const extracted = await file!.async('nodebuffer')
    expect(extracted).toEqual(PNG_BYTES)
  })
})

describe('extractImages', () => {
  it('extracts image from ZIP to outputDir and returns path map', async () => {
    const hwpxPath = join(testDir, 'single.hwpx')
    const outputDir = join(testDir, 'extract-single')
    const zip = new JSZip()
    zip.file('BinData/image0.png', PNG_BYTES)
    await writeFile(hwpxPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const images: Image[] = [
      {
        ref: 's0.img0',
        binDataPath: 'BinData/image0.png',
        width: 0,
        height: 0,
        format: 'png',
      },
    ]

    const result = await extractImages(hwpxPath, images, outputDir)
    const extractedPath = join(outputDir, 'image0.png')

    expect(existsSync(extractedPath)).toBe(true)
    expect(result.get('BinData/image0.png')).toBe('image0.png')
  })

  it('warns and skips missing BinData entries', async () => {
    const hwpxPath = join(testDir, 'missing-entry.hwpx')
    const outputDir = join(testDir, 'extract-missing')
    const zip = new JSZip()
    await writeFile(hwpxPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const images: Image[] = [
      {
        ref: 's0.img0',
        binDataPath: 'BinData/image0.png',
        width: 0,
        height: 0,
        format: 'png',
      },
    ]

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const result = await extractImages(hwpxPath, images, outputDir)

      expect(result.size).toBe(0)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('BinData/image0.png')
    } finally {
      console.warn = originalWarn
    }
  })

  it('creates outputDir if it does not exist', async () => {
    const hwpxPath = join(testDir, 'create-dir.hwpx')
    const outputDir = join(testDir, 'nested', 'images')
    const zip = new JSZip()
    zip.file('BinData/image0.png', PNG_BYTES)
    await writeFile(hwpxPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const images: Image[] = [
      {
        ref: 's0.img0',
        binDataPath: 'BinData/image0.png',
        width: 0,
        height: 0,
        format: 'png',
      },
    ]

    await extractImages(hwpxPath, images, outputDir)

    expect(existsSync(outputDir)).toBe(true)
    expect(existsSync(join(outputDir, 'image0.png'))).toBe(true)
  })

  it('extracts multiple images and returns all map entries', async () => {
    const hwpxPath = join(testDir, 'multiple.hwpx')
    const outputDir = join(testDir, 'extract-multiple')
    const zip = new JSZip()
    zip.file('BinData/image0.png', PNG_BYTES)
    zip.file('BinData/image1.jpg', JPEG_BYTES)
    await writeFile(hwpxPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const images: Image[] = [
      {
        ref: 's0.img0',
        binDataPath: 'BinData/image0.png',
        width: 0,
        height: 0,
        format: 'png',
      },
      {
        ref: 's0.img1',
        binDataPath: 'BinData/image1.jpg',
        width: 0,
        height: 0,
        format: 'jpg',
      },
    ]

    const result = await extractImages(hwpxPath, images, outputDir)

    expect(existsSync(join(outputDir, 'image0.png'))).toBe(true)
    expect(existsSync(join(outputDir, 'image1.jpg'))).toBe(true)
    expect(result.size).toBe(2)
    expect(result.get('BinData/image0.png')).toBe('image0.png')
    expect(result.get('BinData/image1.jpg')).toBe('image1.jpg')
  })
})
