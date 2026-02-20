import { XMLParser } from 'fast-xml-parser'
import type { CharShape, DocumentHeader, FontFace, ParaShape, Style } from '@/types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  isArray: (_name) => ['hh:fontface', 'hh:charPr', 'hh:paraPr', 'hh:style'].includes(_name),
})

type AlignValue = 'left' | 'center' | 'right' | 'justify'

const ALIGN_MAP: Record<string, AlignValue> = {
  JUSTIFY: 'justify',
  CENTER: 'center',
  LEFT: 'left',
  RIGHT: 'right',
}

function colorToHex(colorInt: number): string {
  const r = (colorInt >> 16) & 0xff
  const g = (colorInt >> 8) & 0xff
  const b = colorInt & 0xff
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function parseAlign(align: string): AlignValue {
  return ALIGN_MAP[align] ?? 'left'
}

function toBool(value: number | string | undefined): boolean {
  return value === 1 || value === '1'
}

export function parseHeader(xml: string): DocumentHeader {
  const parsed = parser.parse(xml)
  const refList = parsed['hh:head']?.['hh:refList'] ?? {}

  const rawFonts = refList['hh:fontfaces']?.['hh:fontface'] ?? []
  const fonts: FontFace[] = rawFonts.map((f: Record<string, unknown>) => ({
    id: f['hh:id'] as number,
    name: f['hh:face'] as string,
  }))

  const rawCharPrs = refList['hh:charProperties']?.['hh:charPr'] ?? []
  const charShapes: CharShape[] = rawCharPrs.map((c: Record<string, unknown>) => ({
    id: c['hh:id'] as number,
    fontRef: c['hh:fontRef'] as number,
    fontSize: Math.round((c['hh:height'] as number) / 100),
    bold: toBool(c['hh:fontBold'] as number | string | undefined),
    italic: toBool(c['hh:fontItalic'] as number | string | undefined),
    underline: toBool(c['hh:underline'] as number | string | undefined),
    color: colorToHex(c['hh:color'] as number),
  }))

  const rawParaPrs = refList['hh:paraProperties']?.['hh:paraPr'] ?? []
  const paraShapes: ParaShape[] = rawParaPrs.map((p: Record<string, unknown>) => ({
    id: p['hh:id'] as number,
    align: parseAlign(p['hh:align'] as string),
  }))

  const rawStyles = refList['hh:styles']?.['hh:style'] ?? []
  const styles: Style[] = rawStyles.map((s: Record<string, unknown>) => ({
    id: s['hh:id'] as number,
    name: s['hh:name'] as string,
    charShapeRef: s['hh:charPrIDRef'] as number,
    paraShapeRef: s['hh:paraPrIDRef'] as number,
  }))

  return { fonts, charShapes, paraShapes, styles }
}
