import { describe, expect, it } from 'bun:test'
import { CharShapeRegistry } from './charshape-registry'

describe('CharShapeRegistry', () => {
  it('starts with 1 base shape at index 0 with correct defaults', () => {
    const registry = new CharShapeRegistry(1, 12)
    const shapes = registry.getCharShapes()

    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toEqual({
      id: 0,
      fontRef: 1,
      fontSize: 12,
      bold: false,
      italic: false,
      underline: false,
      color: '#000000',
    })
  })

  it('getRef({}) returns 0 and does not create new shape', () => {
    const registry = new CharShapeRegistry(1, 12)
    const ref = registry.getRef({})

    expect(ref).toBe(0)
    expect(registry.getCharShapes()).toHaveLength(1)
  })

  it('getRef({ bold: true }) creates shape at index 1 with bold=true', () => {
    const registry = new CharShapeRegistry(1, 12)
    const ref = registry.getRef({ bold: true })

    expect(ref).toBe(1)
    const shapes = registry.getCharShapes()
    expect(shapes).toHaveLength(2)
    expect(shapes[1]).toEqual({
      id: 1,
      fontRef: 1,
      fontSize: 12,
      bold: true,
      italic: false,
      underline: false,
      color: '#000000',
    })
  })

  it('getRef({ italic: true }) creates shape at index 2 with italic=true', () => {
    const registry = new CharShapeRegistry(1, 12)
    registry.getRef({ bold: true })
    const ref = registry.getRef({ italic: true })

    expect(ref).toBe(2)
    const shapes = registry.getCharShapes()
    expect(shapes).toHaveLength(3)
    expect(shapes[2]).toEqual({
      id: 2,
      fontRef: 1,
      fontSize: 12,
      bold: false,
      italic: true,
      underline: false,
      color: '#000000',
    })
  })

  it('getRef({ bold: true, italic: true }) creates distinct shape (combo)', () => {
    const registry = new CharShapeRegistry(1, 12)
    registry.getRef({ bold: true })
    registry.getRef({ italic: true })
    const ref = registry.getRef({ bold: true, italic: true })

    expect(ref).toBe(3)
    const shapes = registry.getCharShapes()
    expect(shapes).toHaveLength(4)
    expect(shapes[3]).toEqual({
      id: 3,
      fontRef: 1,
      fontSize: 12,
      bold: true,
      italic: true,
      underline: false,
      color: '#000000',
    })
  })

  it('calling getRef({ bold: true }) twice returns same index (deduplication)', () => {
    const registry = new CharShapeRegistry(1, 12)
    const ref1 = registry.getRef({ bold: true })
    const ref2 = registry.getRef({ bold: true })

    expect(ref1).toBe(ref2)
    expect(ref1).toBe(1)
    expect(registry.getCharShapes()).toHaveLength(2)
  })

  it('getRef({ bold: true, fontRef: 1 }) creates distinct shape (different fontRef)', () => {
    const registry = new CharShapeRegistry(0, 12)
    const ref1 = registry.getRef({ bold: true })
    const ref2 = registry.getRef({ bold: true, fontRef: 1 })

    expect(ref1).toBe(1)
    expect(ref2).toBe(2)
    const shapes = registry.getCharShapes()
    expect(shapes).toHaveLength(3)
    expect(shapes[1].fontRef).toBe(0)
    expect(shapes[2].fontRef).toBe(1)
  })

  it('getCharShapes() returns array where every shape id equals its array index', () => {
    const registry = new CharShapeRegistry(1, 12)
    registry.getRef({ bold: true })
    registry.getRef({ italic: true })
    registry.getRef({ bold: true, italic: true })

    const shapes = registry.getCharShapes()
    shapes.forEach((shape, index) => {
      expect(shape.id).toBe(index)
    })
  })

  it('base fontSize preserved in all created shapes', () => {
    const registry = new CharShapeRegistry(1, 16)
    registry.getRef({ bold: true })
    registry.getRef({ italic: true })
    registry.getRef({ underline: true })

    const shapes = registry.getCharShapes()
    shapes.forEach((shape) => {
      expect(shape.fontSize).toBe(16)
    })
  })

  it('getRef({ underline: true }) creates distinct shape from bold/italic', () => {
    const registry = new CharShapeRegistry(1, 12)
    const ref1 = registry.getRef({ bold: true })
    const ref2 = registry.getRef({ italic: true })
    const ref3 = registry.getRef({ underline: true })

    expect(ref1).toBe(1)
    expect(ref2).toBe(2)
    expect(ref3).toBe(3)
    expect(registry.getCharShapes()).toHaveLength(4)
  })

  it('uses custom base color when provided', () => {
    const registry = new CharShapeRegistry(1, 12, '#FF0000')
    const shapes = registry.getCharShapes()

    expect(shapes[0].color).toBe('#FF0000')
  })

  it('preserves base color in all created shapes', () => {
    const registry = new CharShapeRegistry(1, 12, '#00FF00')
    registry.getRef({ bold: true })
    registry.getRef({ italic: true })

    const shapes = registry.getCharShapes()
    shapes.forEach((shape) => {
      expect(shape.color).toBe('#00FF00')
    })
  })
})
