import { describe, expect, it } from 'bun:test'
import { formatOutput } from './output'

describe('formatOutput', () => {
  it('outputs compact JSON by default', () => {
    const result = formatOutput({ a: 1, b: 'hello' })
    expect(result).toBe('{"a":1,"b":"hello"}')
  })

  it('outputs pretty JSON when pretty=true', () => {
    const result = formatOutput({ a: 1 }, true)
    expect(result).toBe('{\n  "a": 1\n}')
  })

  it('outputs compact JSON when pretty=false', () => {
    const result = formatOutput({ a: 1 }, false)
    expect(result).toBe('{"a":1}')
  })

  it('handles arrays', () => {
    const result = formatOutput([1, 2, 3])
    expect(result).toBe('[1,2,3]')
  })

  it('handles null', () => {
    const result = formatOutput(null)
    expect(result).toBe('null')
  })

  it('handles strings', () => {
    const result = formatOutput('hello')
    expect(result).toBe('"hello"')
  })

  it('handles nested objects', () => {
    const result = formatOutput({ sections: [{ paragraphs: [] }] })
    expect(result).toBe('{"sections":[{"paragraphs":[]}]}')
  })
})
