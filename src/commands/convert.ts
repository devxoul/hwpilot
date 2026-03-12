import { access, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'

import JSZip from 'jszip'

import { loadHwp } from '@/formats/hwp/reader'
import { parseHeader } from '@/formats/hwpx/header-parser'
import { loadHwpx } from '@/formats/hwpx/loader'
import { NAMESPACES } from '@/formats/hwpx/namespaces'
import { PATHS, sectionPath } from '@/formats/hwpx/paths'
import { parseSections } from '@/formats/hwpx/section-parser'
import { embedImage, extractImages, resolveImagePaths } from '@/markdown/image-handler'
import { markdownToHwpBinary } from '@/markdown/to-hwp-binary'
import { markdownToHwp } from '@/markdown/to-hwp'
import { hwpToMarkdown } from '@/markdown/to-markdown'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import type { CharShape, DocumentHeader, HwpDocument, Image, ParaShape, Section } from '@/types'

type ConvertOptions = {
  pretty?: boolean
  force?: boolean
  imagesDir?: string
}

export async function convertCommand(input: string, output: string, options: ConvertOptions): Promise<void> {
  try {
    const isMdInput = hasExtension(input, 'md')
    const isHwpInput = hasExtension(input, 'hwp')
    const isHwpxInput = hasExtension(input, 'hwpx')
    const isMdOutput = hasExtension(output, 'md')
    const isHwpOutput = hasExtension(output, 'hwp')
    const isHwpxOutput = hasExtension(output, 'hwpx')

    if (!options.force) {
      try {
        await access(output)
        throw new Error(`File already exists: ${output}`)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('File already exists')) throw e
      }
    }

    if (isMdInput && isHwpxOutput) {
      const md = await readFile(input, 'utf-8')
      const doc = markdownToHwp(md)

      const allImages = doc.sections.flatMap((s) => s.images)
      const imageLocalPaths: string[] = []
      if (allImages.length > 0) {
        const mdDir = dirname(input)
        const imageRefs = allImages.map((img) => ({ url: img.binDataPath, alt: '' }))
        const resolved = resolveImagePaths(imageRefs, mdDir)
        for (const r of resolved) {
          imageLocalPaths.push(r.resolvedPath ?? '')
        }
      }

      const buffer = await generateHwpx(doc, imageLocalPaths)

      await writeFile(output, buffer)

      const paragraphs = countParagraphs(doc)
      console.log(
        formatOutput(
          {
            input,
            output,
            direction: 'md-to-hwpx',
            sections: doc.sections.length,
            paragraphs,
            success: true,
          },
          options.pretty,
        ),
      )
      return
    }

    if (isMdInput && isHwpOutput) {
      const md = await readFile(input, 'utf-8')
      const doc = markdownToHwp(md)
      const buffer = await markdownToHwpBinary(md)

      await writeFile(output, buffer)

      const paragraphs = countParagraphs(doc)
      console.log(
        formatOutput(
          {
            input,
            output,
            direction: 'md-to-hwp',
            sections: doc.sections.length,
            paragraphs,
            success: true,
          },
          options.pretty,
        ),
      )
      return
    }

    if ((isHwpInput || isHwpxInput) && isMdOutput) {
      const fmt = await detectFormat(input)
      const doc = fmt === 'hwp' ? await loadHwp(input) : await loadHwpxDocument(input)
      let md = hwpToMarkdown(doc)

      // Extract images from HWPX (not supported for HWP binary)
      const allImages = doc.sections.flatMap((s) => s.images)
      let extractedImagesDir: string | undefined
      if (fmt === 'hwpx' && allImages.length > 0) {
        const imagesDir = options.imagesDir ?? join(dirname(output), basename(output, extname(output)) + '_images')
        try {
          const pathMap = await extractImages(input, allImages, imagesDir)
          extractedImagesDir = imagesDir
          const outputDir = dirname(output)
          for (const [binDataPath, filename] of pathMap) {
            const relativePath = relative(outputDir, join(imagesDir, filename))
            md = md.replaceAll(`![](${binDataPath})`, `![](${relativePath})`)
          }
        } catch (e) {
          console.warn(`Warning: failed to extract images: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      await writeFile(output, md, 'utf-8')

      const paragraphs = countParagraphs(doc)
      console.log(
        formatOutput(
          {
            input,
            output,
            direction: 'hwp-to-md',
            sections: doc.sections.length,
            paragraphs,
            ...(extractedImagesDir ? { imagesDir: extractedImagesDir } : {}),
            success: true,
          },
          options.pretty,
        ),
      )
      return
    }

    if (isHwpInput && isHwpxOutput) {
      const inputFormat = await detectFormat(input)
      if (inputFormat !== 'hwp') {
        throw new Error('Input must be a HWP 5.0 file')
      }

      const doc = await loadHwp(input)
      const buffer = await generateHwpx(doc)

      await writeFile(output, buffer)

      const paragraphs = countParagraphs(doc)
      console.log(
        formatOutput(
          {
            input,
            output,
            sections: doc.sections.length,
            paragraphs,
            success: true,
          },
          options.pretty,
        ),
      )
      return
    }

    throw new Error(`Unsupported conversion: ${input} -> ${output}`)
  } catch (e) {
    handleError(e)
  }
}

function countParagraphs(doc: HwpDocument): number {
  return doc.sections.reduce((sum, section) => sum + section.paragraphs.length, 0)
}

async function loadHwpxDocument(filePath: string): Promise<HwpDocument> {
  const archive = await loadHwpx(filePath)
  const header = parseHeader(await archive.getHeaderXml())
  const sections = await parseSections(archive)
  return { format: 'hwpx', sections, header }
}

export async function generateHwpx(doc: HwpDocument, imageLocalPaths: string[] = []): Promise<Buffer> {
  const zip = new JSZip()
  const embeddedImagesBySourceIndex: Array<Image | null> = []

  zip.file(PATHS.VERSION_XML, generateVersionXml())
  zip.file(PATHS.MANIFEST_XML, generateManifest(doc.sections.length))
  zip.file(PATHS.CONTENT_HPF, generateContentHpf(doc.sections.length))
  zip.file(PATHS.HEADER_XML, generateHeaderXml(doc.header))

  for (let i = 0; i < imageLocalPaths.length; i++) {
    const localPath = imageLocalPaths[i]
    if (localPath) {
      embeddedImagesBySourceIndex[i] = await embedImage(zip, localPath, i)
      continue
    }
    embeddedImagesBySourceIndex[i] = null
  }

  let sourceImageOffset = 0
  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i]
    const sectionImages =
      imageLocalPaths.length > 0
        ? embeddedImagesBySourceIndex
            .slice(sourceImageOffset, sourceImageOffset + section.images.length)
            .filter((image): image is Image => image !== null)
        : section.images

    sourceImageOffset += section.images.length
    zip.file(sectionPath(i), generateSectionXml(section, sectionImages))
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}

function hasExtension(filePath: string, extension: string): boolean {
  return filePath.toLowerCase().endsWith(`.${extension}`)
}

function generateVersionXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:version xmlns:hv="${NAMESPACES.hv}" major="5" minor="1" micro="0" buildNumber="0"/>`
}

function generateManifest(sectionCount: number): string {
  const sectionEntries = Array.from({ length: sectionCount }, (_value, index) => {
    const section = sectionPath(index)
    return `  <manifest:file-entry manifest:full-path="${section}" manifest:media-type="text/xml"/>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<manifest:manifest xmlns:manifest="${NAMESPACES.odf}">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/>
  <manifest:file-entry manifest:full-path="${PATHS.HEADER_XML}" manifest:media-type="text/xml"/>
${sectionEntries}
</manifest:manifest>`
}

function generateContentHpf(sectionCount: number): string {
  const manifestItems = Array.from({ length: sectionCount }, (_value, index) => {
    return `    <opf:item id="section${index}" href="section${index}.xml" media-type="text/xml"/>`
  }).join('\n')

  const spineItems = Array.from({ length: sectionCount }, (_value, index) => {
    return `    <opf:itemref idref="section${index}"/>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="${NAMESPACES.opf}">
  <opf:manifest>
    <opf:item id="header" href="header.xml" media-type="text/xml"/>
${manifestItems}
  </opf:manifest>
  <opf:spine>
${spineItems}
  </opf:spine>
</opf:package>`
}

function generateHeaderXml(header: DocumentHeader): string {
  const fonts = header.fonts
    .map((font) => `      <hh:fontface hh:id="${font.id}" hh:face="${escapeXml(font.name)}"/>`)
    .join('\n')

  const charShapes = header.charShapes
    .map((charShape) => `      <hh:charPr ${generateCharShapeAttrs(charShape)}/>`)
    .join('\n')

  const paraShapes = header.paraShapes
    .map((paraShape) => {
      const attrs = generateParaShapeAttrs(paraShape)
      const headingElement = generateHeadingElement(paraShape)
      return headingElement
        ? `      <hh:paraPr ${attrs}>\n        ${headingElement}\n      </hh:paraPr>`
        : `      <hh:paraPr ${attrs}/>`
    })
    .join('\n')

  const styles = header.styles
    .map((style) => {
      const typeAttr = style.type ? ` hh:type="${style.type}"` : ''
      return `      <hh:style hh:id="${style.id}" hh:name="${escapeXml(style.name)}" hh:charPrIDRef="${style.charShapeRef}" hh:paraPrIDRef="${style.paraShapeRef}"${typeAttr}/>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="${NAMESPACES.hh}">
  <hh:refList>
    <hh:fontfaces>
${fonts}
    </hh:fontfaces>
    <hh:charProperties>
${charShapes}
    </hh:charProperties>
    <hh:paraProperties>
${paraShapes}
    </hh:paraProperties>
    <hh:styles>
${styles}
    </hh:styles>
  </hh:refList>
</hh:head>`
}

function generateSectionXml(section: Section, images: Image[] = section.images): string {
  const paragraphXml = section.paragraphs
    .map((paragraph, paragraphIndex) => {
      const runs = paragraph.runs
        .map((run) => `      <hp:run hp:charPrIDRef="${run.charShapeRef}"><hp:t>${escapeXml(run.text)}</hp:t></hp:run>`)
        .join('\n')

      return `  <hp:p hp:id="${paragraphIndex}" hp:paraPrIDRef="${paragraph.paraShapeRef}" hp:styleIDRef="${paragraph.styleRef}">
${runs}
  </hp:p>`
    })
    .join('\n')

  const tableXml = section.tables
    .map((table) => {
      const rows = table.rows
        .map((row, rowIndex) => {
          const cells = row.cells
            .map((cell, cellIndex) => {
              const cellParagraphs = cell.paragraphs
                .map((paragraph, paragraphIndex) => {
                  const runs = paragraph.runs
                    .map(
                      (run) =>
                        `            <hp:run hp:charPrIDRef="${run.charShapeRef}"><hp:t>${escapeXml(run.text)}</hp:t></hp:run>`,
                    )
                    .join('\n')

                  return `          <hp:p hp:id="${paragraphIndex}" hp:paraPrIDRef="${paragraph.paraShapeRef}" hp:styleIDRef="${paragraph.styleRef}">
${runs}
          </hp:p>`
                })
                .join('\n')

              return `      <hp:tc>
        <hp:cellAddr hp:colAddr="${cellIndex}" hp:rowAddr="${rowIndex}"/>
        <hp:cellSpan hp:colSpan="${cell.colSpan}" hp:rowSpan="${cell.rowSpan}"/>
${cellParagraphs}
      </hp:tc>`
            })
            .join('\n')

          return `    <hp:tr>
${cells}
    </hp:tr>`
        })
        .join('\n')

      return `  <hp:tbl>
${rows}
  </hp:tbl>`
    })
    .join('\n')

  const imageXml = images
    .map((image) => {
      return `  <hp:pic hp:id="${escapeXml(image.ref)}" hp:binDataPath="${escapeXml(image.binDataPath)}" hp:format="${escapeXml(image.format)}" hp:width="${image.width}" hp:height="${image.height}">\n    <hp:imgRect><hc:pt0/></hp:imgRect>\n  </hp:pic>`
    })
    .join('\n')

  const content = [paragraphXml, tableXml, imageXml].filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="${NAMESPACES.hs}" xmlns:hp="${NAMESPACES.hp}" xmlns:hc="${NAMESPACES.hc}" xmlns:hh="${NAMESPACES.hh}">
${content}
</hs:sec>`
}

function generateCharShapeAttrs(charShape: CharShape): string {
  return [
    `hh:id="${charShape.id}"`,
    `hh:height="${Math.round(charShape.fontSize * 100)}"`,
    `hh:fontRef="${charShape.fontRef}"`,
    `hh:fontBold="${charShape.bold ? 1 : 0}"`,
    `hh:fontItalic="${charShape.italic ? 1 : 0}"`,
    `hh:underline="${charShape.underline ? 1 : 0}"`,
    `hh:color="${colorHexToDecimal(charShape.color)}"`,
  ].join(' ')
}

function generateParaShapeAttrs(paraShape: ParaShape): string {
  return [`hh:id="${paraShape.id}"`, `hh:align="${toHwpxAlign(paraShape.align)}"`].join(' ')
}

function generateHeadingElement(paraShape: ParaShape): string | null {
  if (!paraShape.headingLevel || paraShape.headingLevel <= 0) {
    return null
  }
  return `<hh:heading hh:type="OUTLINE" hh:idRef="0" hh:level="${paraShape.headingLevel}"/>`
}

function toHwpxAlign(align: ParaShape['align']): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY' {
  if (align === 'left') {
    return 'LEFT'
  }
  if (align === 'center') {
    return 'CENTER'
  }
  if (align === 'right') {
    return 'RIGHT'
  }
  return 'JUSTIFY'
}

function colorHexToDecimal(color: string): number {
  const normalized = color.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return 0
  }
  return Number.parseInt(normalized.slice(1), 16)
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
