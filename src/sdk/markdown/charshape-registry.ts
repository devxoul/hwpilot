import type { CharShape } from '@/types'

type CharShapeOptions = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontRef?: number
}

export class CharShapeRegistry {
  private shapes: CharShape[] = []
  private keyMap: Map<string, number> = new Map()
  private baseFontRef: number
  private baseFontSize: number
  private baseColor: string

  constructor(baseFontRef: number, baseFontSize: number, baseColor: string = '#000000') {
    this.baseFontRef = baseFontRef
    this.baseFontSize = baseFontSize
    this.baseColor = baseColor

    const baseShape: CharShape = {
      id: 0,
      fontRef: baseFontRef,
      fontSize: baseFontSize,
      bold: false,
      italic: false,
      underline: false,
      color: baseColor,
    }

    this.shapes.push(baseShape)
    this.keyMap.set(`${baseFontRef}:false:false:false`, 0)
  }

  getRef(options: CharShapeOptions = {}): number {
    const fontRef = options.fontRef ?? this.baseFontRef
    const bold = options.bold ?? false
    const italic = options.italic ?? false
    const underline = options.underline ?? false

    const key = `${fontRef}:${bold}:${italic}:${underline}`

    if (this.keyMap.has(key)) {
      return this.keyMap.get(key)!
    }

    const newShape: CharShape = {
      id: this.shapes.length,
      fontRef,
      fontSize: this.baseFontSize,
      bold,
      italic,
      underline,
      color: this.baseColor,
    }

    const index = this.shapes.length
    this.shapes.push(newShape)
    this.keyMap.set(key, index)

    return index
  }

  getCharShapes(): CharShape[] {
    return this.shapes
  }
}
