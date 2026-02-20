import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { loadHwp } from '@/formats/hwp/reader'
import { NAMESPACES } from '@/formats/hwpx/namespaces'
import { PATHS, sectionPath } from '@/formats/hwpx/paths'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import type { CharShape, DocumentHeader, HwpDocument, ParaShape, Section } from '@/types'

type ConvertOptions = {
  pretty?: boolean
}

export async function convertCommand(input: string, output: string, options: ConvertOptions): Promise<void> {
  try {
    const inputFormat = await detectFormat(input)

    if (inputFormat !== 'hwp') {
      throw new Error('Input must be a HWP 5.0 file')
    }

    if (!hasExtension(output, 'hwpx')) {
      throw new Error('Output must be a .hwpx file')
    }

    const doc = await loadHwp(input)
    const buffer = await generateHwpx(doc)

    await writeFile(output, buffer)

    const paragraphs = doc.sections.reduce((sum, section) => sum + section.paragraphs.length, 0)
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
  } catch (e) {
    handleError(e)
  }
}

export async function generateHwpx(doc: HwpDocument): Promise<Buffer> {
  const zip = new JSZip()

  zip.file(PATHS.VERSION_XML, generateVersionXml())
  zip.file(PATHS.MANIFEST_XML, generateManifest(doc.sections.length))
  zip.file(PATHS.CONTENT_HPF, generateContentHpf(doc.sections.length))
  zip.file(PATHS.HEADER_XML, generateHeaderXml(doc.header))

  for (let i = 0; i < doc.sections.length; i++) {
    zip.file(sectionPath(i), generateSectionXml(doc.sections[i]))
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
    .map((paraShape) => `      <hh:paraPr ${generateParaShapeAttrs(paraShape)}/>`)
    .join('\n')

  const styles = header.styles
    .map(
      (style) =>
        `      <hh:style hh:id="${style.id}" hh:name="${escapeXml(style.name)}" hh:charPrIDRef="${style.charShapeRef}" hh:paraPrIDRef="${style.paraShapeRef}"/>`,
    )
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

function generateSectionXml(section: Section): string {
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

  const content = [paragraphXml, tableXml].filter(Boolean).join('\n')

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
