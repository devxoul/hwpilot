import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { handleError } from './error-handler'

let errors: string[]
const origError = console.error
const origExit = process.exit

function captureOutput() {
  errors = []
  console.error = (msg: string) => errors.push(msg)
  process.exit = mock(() => {
    throw new Error('process.exit')
  }) as never
}

function restoreOutput() {
  console.error = origError
  process.exit = origExit
}

beforeEach(captureOutput)
afterEach(restoreOutput)

describe('handleError', () => {
  it('outputs JSON with error field from Error object', () => {
    expect(() => handleError(new Error('test error'))).toThrow('process.exit')
    const output = JSON.parse(errors[0])
    expect(output).toEqual({ error: 'test error' })
  })

  it('outputs JSON with error field from string', () => {
    expect(() => handleError('string error')).toThrow('process.exit')
    const output = JSON.parse(errors[0])
    expect(output).toEqual({ error: 'string error' })
  })

  it('includes context when provided', () => {
    expect(() => handleError(new Error('not found'), { context: { ref: 's0.p99', file: 'test.hwp' } })).toThrow(
      'process.exit',
    )
    const output = JSON.parse(errors[0])
    expect(output.error).toBe('not found')
    expect(output.context).toEqual({ ref: 's0.p99', file: 'test.hwp' })
  })

  it('includes hint when provided', () => {
    expect(() => handleError(new Error('not found'), { hint: 'Valid refs: s0.p0 through s0.p5' })).toThrow(
      'process.exit',
    )
    const output = JSON.parse(errors[0])
    expect(output.error).toBe('not found')
    expect(output.hint).toBe('Valid refs: s0.p0 through s0.p5')
  })

  it('includes both context and hint', () => {
    expect(() =>
      handleError(new Error('fail'), {
        context: { ref: 's0.p99' },
        hint: 'Try s0.p0',
      }),
    ).toThrow('process.exit')
    const output = JSON.parse(errors[0])
    expect(output.error).toBe('fail')
    expect(output.context).toEqual({ ref: 's0.p99' })
    expect(output.hint).toBe('Try s0.p0')
  })

  it('omits context and hint when not provided', () => {
    expect(() => handleError(new Error('basic'))).toThrow('process.exit')
    const output = JSON.parse(errors[0])
    expect(output).toEqual({ error: 'basic' })
    expect('context' in output).toBe(false)
    expect('hint' in output).toBe(false)
  })

  it('omits context and hint when options is empty object', () => {
    expect(() => handleError(new Error('basic'), {})).toThrow('process.exit')
    const output = JSON.parse(errors[0])
    expect(output).toEqual({ error: 'basic' })
    expect('context' in output).toBe(false)
    expect('hint' in output).toBe(false)
  })

  it('always outputs valid JSON', () => {
    expect(() =>
      handleError(new Error('message with "quotes" and \nnewlines'), {
        context: { ref: 's0.p0' },
        hint: 'a hint',
      }),
    ).toThrow('process.exit')
    expect(() => JSON.parse(errors[0])).not.toThrow()
  })
})
