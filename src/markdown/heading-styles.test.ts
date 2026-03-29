import { describe, expect, it } from 'bun:test'
import type { Paragraph, ParaShape, Style } from '@/types'
import {
  headingStyleName,
  getHeadingLevel,
  createHeadingInfrastructure,
} from './heading-styles'

describe('headingStyleName', () => {
  it('maps level 1 to "개요 1"', () => {
    expect(headingStyleName(1)).toBe('개요 1')
  })

  it('maps level 6 to "개요 6"', () => {
    expect(headingStyleName(6)).toBe('개요 6')
  })

  it('caps level 7 to "개요 7"', () => {
    expect(headingStyleName(7)).toBe('개요 7')
  })

  it('caps level 10 to "개요 7"', () => {
    expect(headingStyleName(10)).toBe('개요 7')
  })

  it('treats level 0 as level 1', () => {
    expect(headingStyleName(0)).toBe('개요 1')
  })

  it('treats negative level as level 1', () => {
    expect(headingStyleName(-5)).toBe('개요 1')
  })
})

describe('getHeadingLevel', () => {
  it('detects heading from style name "개요 3"', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 1,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: '개요 3',
        charShapeRef: 1,
        paraShapeRef: 1,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = []

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBe(3)
  })

  it('detects heading from English "Heading 2"', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 1,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: 'Heading 2',
        charShapeRef: 1,
        paraShapeRef: 1,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = []

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBe(2)
  })

  it('detects heading from English "Outline 1"', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 1,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: 'Outline 1',
        charShapeRef: 1,
        paraShapeRef: 1,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = []

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBe(1)
  })

  it('detects from paraShape.headingLevel when style name does not match', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 5,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: 'Normal',
        charShapeRef: 1,
        paraShapeRef: 5,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = [
      {
        id: 5,
        align: 'left',
        headingLevel: 4,
      },
    ]

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBe(4)
  })

  it('returns null for body paragraph', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 1,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: 'Normal',
        charShapeRef: 1,
        paraShapeRef: 1,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = [
      {
        id: 1,
        align: 'left',
      },
    ]

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBeNull()
  })

  it('prioritizes style name over paraShape.headingLevel', () => {
    const paragraph: Paragraph = {
      ref: 's0.p0',
      runs: [],
      paraShapeRef: 5,
      styleRef: 10,
    }
    const styles: Style[] = [
      {
        id: 10,
        name: '개요 2',
        charShapeRef: 1,
        paraShapeRef: 5,
        type: 'PARA',
      },
    ]
    const paraShapes: ParaShape[] = [
      {
        id: 5,
        align: 'left',
        headingLevel: 4,
      },
    ]

    expect(getHeadingLevel(paragraph, styles, paraShapes)).toBe(2)
  })
})

describe('createHeadingInfrastructure', () => {
  it('creates exactly 6 paraShapes and 6 styles', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    expect(result.paraShapes).toHaveLength(6)
    expect(result.styles).toHaveLength(6)
  })

  it('creates sequential IDs from base+1', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    expect(result.paraShapes[0].id).toBe(201)
    expect(result.paraShapes[1].id).toBe(202)
    expect(result.paraShapes[5].id).toBe(206)

    expect(result.styles[0].id).toBe(301)
    expect(result.styles[1].id).toBe(302)
    expect(result.styles[5].id).toBe(306)
  })

  it('creates style names "개요 1" through "개요 6"', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    expect(result.styles[0].name).toBe('개요 1')
    expect(result.styles[1].name).toBe('개요 2')
    expect(result.styles[5].name).toBe('개요 6')
  })

  it('sets paraShape.headingLevel to 1-6 respectively', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    expect(result.paraShapes[0].headingLevel).toBe(1)
    expect(result.paraShapes[1].headingLevel).toBe(2)
    expect(result.paraShapes[5].headingLevel).toBe(6)
  })

  it('sets all paraShapes to align left', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    result.paraShapes.forEach((ps) => {
      expect(ps.align).toBe('left')
    })
  })

  it('sets style.type to PARA', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    result.styles.forEach((s) => {
      expect(s.type).toBe('PARA')
    })
  })

  it('sets all styles charShapeRef to baseCharShapeRef', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    result.styles.forEach((s) => {
      expect(s.charShapeRef).toBe(100)
    })
  })

  it('each style paraShapeRef points to corresponding paraShape', () => {
    const result = createHeadingInfrastructure(100, 200, 300)

    for (let i = 0; i < 6; i++) {
      expect(result.styles[i].paraShapeRef).toBe(result.paraShapes[i].id)
    }
  })
})
