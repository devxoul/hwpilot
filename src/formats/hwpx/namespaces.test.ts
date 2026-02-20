import { describe, expect, it } from 'bun:test'
import { NAMESPACES } from './namespaces'
import { PATHS, sectionPath } from './paths'

describe('NAMESPACES', () => {
  it('hp namespace is correct', () => {
    expect(NAMESPACES.hp).toBe('http://www.hancom.co.kr/hwpml/2011/paragraph')
  })

  it('hs namespace is correct', () => {
    expect(NAMESPACES.hs).toBe('http://www.hancom.co.kr/hwpml/2011/section')
  })

  it('hh namespace is correct', () => {
    expect(NAMESPACES.hh).toBe('http://www.hancom.co.kr/hwpml/2011/head')
  })

  it('hc namespace is correct', () => {
    expect(NAMESPACES.hc).toBe('http://www.hancom.co.kr/hwpml/2011/core')
  })
})

describe('PATHS', () => {
  it('VERSION_XML path is correct', () => {
    expect(PATHS.VERSION_XML).toBe('version.xml')
  })

  it('HEADER_XML path is correct', () => {
    expect(PATHS.HEADER_XML).toBe('Contents/header.xml')
  })

  it('sectionPath generates correct paths', () => {
    expect(sectionPath(0)).toBe('Contents/section0.xml')
    expect(sectionPath(1)).toBe('Contents/section1.xml')
    expect(sectionPath(99)).toBe('Contents/section99.xml')
  })

  it('BIN_DATA_DIR ends with slash', () => {
    expect(PATHS.BIN_DATA_DIR).toBe('BinData/')
  })
})
