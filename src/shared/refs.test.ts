import { describe, expect, it } from 'bun:test'
import { buildRef, parseRef, validateRef } from './refs'

describe('parseRef', () => {
  it('parses section ref', () => {
    expect(parseRef('s0')).toEqual({ section: 0 })
    expect(parseRef('s3')).toEqual({ section: 3 })
  })

  it('parses paragraph ref', () => {
    expect(parseRef('s0.p0')).toEqual({ section: 0, paragraph: 0 })
    expect(parseRef('s1.p3')).toEqual({ section: 1, paragraph: 3 })
  })

  it('parses run ref', () => {
    expect(parseRef('s0.p3.r1')).toEqual({ section: 0, paragraph: 3, run: 1 })
  })

  it('parses table ref', () => {
    expect(parseRef('s0.t0')).toEqual({ section: 0, table: 0 })
    expect(parseRef('s0.t1')).toEqual({ section: 0, table: 1 })
  })

  it('parses table row+cell ref', () => {
    expect(parseRef('s0.t1.r2.c0')).toEqual({ section: 0, table: 1, row: 2, cell: 0 })
  })

  it('parses table cell paragraph ref', () => {
    expect(parseRef('s0.t1.r2.c0.p0')).toEqual({ section: 0, table: 1, row: 2, cell: 0, cellParagraph: 0 })
  })

  it('parses image ref', () => {
    expect(parseRef('s0.img0')).toEqual({ section: 0, image: 0 })
    expect(parseRef('s1.img2')).toEqual({ section: 1, image: 2 })
  })

  it('throws for invalid ref', () => {
    expect(() => parseRef('p3')).toThrow()
    expect(() => parseRef('invalid')).toThrow()
    expect(() => parseRef('')).toThrow()
  })
})

describe('validateRef', () => {
  it('returns true for valid refs', () => {
    expect(validateRef('s0')).toBe(true)
    expect(validateRef('s0.p0')).toBe(true)
    expect(validateRef('s0.p3.r1')).toBe(true)
    expect(validateRef('s0.t0')).toBe(true)
    expect(validateRef('s0.t1.r2.c0')).toBe(true)
    expect(validateRef('s0.t1.r2.c0.p0')).toBe(true)
    expect(validateRef('s0.img0')).toBe(true)
  })

  it('returns false for invalid refs', () => {
    expect(validateRef('p3')).toBe(false) // no section
    expect(validateRef('s0.p')).toBe(false) // no index
    expect(validateRef('s0.x1')).toBe(false) // unknown type
    expect(validateRef('s-1.p0')).toBe(false) // negative
    expect(validateRef('')).toBe(false) // empty
    expect(validateRef('s0.t1.r2')).toBe(false) // incomplete table ref
  })
})

describe('buildRef', () => {
  it('builds section ref', () => {
    expect(buildRef({ section: 0 })).toBe('s0')
    expect(buildRef({ section: 3 })).toBe('s3')
  })

  it('builds paragraph ref', () => {
    expect(buildRef({ section: 0, paragraph: 3 })).toBe('s0.p3')
  })

  it('builds run ref', () => {
    expect(buildRef({ section: 0, paragraph: 3, run: 1 })).toBe('s0.p3.r1')
  })

  it('builds table ref', () => {
    expect(buildRef({ section: 0, table: 0 })).toBe('s0.t0')
  })

  it('builds table cell ref', () => {
    expect(buildRef({ section: 0, table: 1, row: 2, cell: 0 })).toBe('s0.t1.r2.c0')
  })

  it('builds table cell paragraph ref', () => {
    expect(buildRef({ section: 0, table: 1, row: 2, cell: 0, cellParagraph: 0 })).toBe('s0.t1.r2.c0.p0')
  })

  it('builds image ref', () => {
    expect(buildRef({ section: 0, image: 0 })).toBe('s0.img0')
  })
})

describe('parseRef - text box refs', () => {
  it('parses text box ref', () => {
    expect(parseRef('s0.tb0')).toEqual({ section: 0, textBox: 0 })
    expect(parseRef('s1.tb2')).toEqual({ section: 1, textBox: 2 })
  })

  it('parses text box paragraph ref', () => {
    expect(parseRef('s0.tb0.p0')).toEqual({ section: 0, textBox: 0, textBoxParagraph: 0 })
    expect(parseRef('s0.tb2.p1')).toEqual({ section: 0, textBox: 2, textBoxParagraph: 1 })
  })

  it('throws for invalid text box ref', () => {
    expect(() => parseRef('s0.tb')).toThrow() // no index
    expect(() => parseRef('s0.tb0.r0')).toThrow() // invalid — no run notation for text boxes
  })
})

describe('validateRef - text box refs', () => {
  it('returns true for valid text box refs', () => {
    expect(validateRef('s0.tb0')).toBe(true)
    expect(validateRef('s0.tb2')).toBe(true)
    expect(validateRef('s0.tb0.p0')).toBe(true)
    expect(validateRef('s0.tb0.p1')).toBe(true)
  })

  it('returns false for invalid text box refs', () => {
    expect(validateRef('s0.tb')).toBe(false) // no index
    expect(validateRef('s0.tb0.r0')).toBe(false) // invalid — no run notation for text boxes
    expect(validateRef('s0.tb-1')).toBe(false) // negative
  })
})

describe('buildRef - text box refs', () => {
  it('builds text box ref', () => {
    expect(buildRef({ section: 0, textBox: 0 })).toBe('s0.tb0')
    expect(buildRef({ section: 1, textBox: 3 })).toBe('s1.tb3')
  })

  it('builds text box paragraph ref', () => {
    expect(buildRef({ section: 0, textBox: 0, textBoxParagraph: 0 })).toBe('s0.tb0.p0')
    expect(buildRef({ section: 1, textBox: 3, textBoxParagraph: 2 })).toBe('s1.tb3.p2')
  })
})
