import type { Paragraph, ParaShape, Style } from '@/types'

const HEADING_REGEX = /^(?:개요|Outline|Heading)\s+(\d+)$/i

export function headingStyleName(level: number): string {
  const normalizedLevel = Math.max(1, Math.min(level, 7))
  return `개요 ${normalizedLevel}`
}

export function getHeadingLevel(
  paragraph: Paragraph,
  styles: Style[],
  paraShapes: ParaShape[]
): number | null {
  const headingLevelFromStyleName = extractHeadingLevelFromStyle(
    paragraph.styleRef,
    styles
  )
  if (headingLevelFromStyleName !== null) {
    return headingLevelFromStyleName
  }

  return extractHeadingLevelFromParaShape(paragraph.paraShapeRef, paraShapes)
}

function extractHeadingLevelFromStyle(
  styleRef: number,
  styles: Style[]
): number | null {
  const style = styles.find((s) => s.id === styleRef)
  if (!style) {
    return null
  }

  const match = style.name.match(HEADING_REGEX)
  if (!match) {
    return null
  }

  return parseInt(match[1], 10)
}

function extractHeadingLevelFromParaShape(
  paraShapeRef: number,
  paraShapes: ParaShape[]
): number | null {
  const paraShape = paraShapes.find((ps) => ps.id === paraShapeRef)
  if (!paraShape || paraShape.headingLevel === undefined) {
    return null
  }

  return paraShape.headingLevel
}

export function createHeadingInfrastructure(
  baseCharShapeRef: number,
  baseParaShapeId: number,
  baseStyleId: number
): { paraShapes: ParaShape[]; styles: Style[] } {
  const paraShapes: ParaShape[] = []
  const styles: Style[] = []

  for (let i = 1; i <= 6; i++) {
    const paraShapeId = baseParaShapeId + i
    const styleId = baseStyleId + i

    paraShapes.push({
      id: paraShapeId,
      align: 'left',
      headingLevel: i,
    })

    styles.push({
      id: styleId,
      name: `개요 ${i}`,
      charShapeRef: baseCharShapeRef,
      paraShapeRef: paraShapeId,
      type: 'PARA',
    })
  }

  return { paraShapes, styles }
}
