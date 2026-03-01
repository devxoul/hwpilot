import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import CFB from 'cfb'
import { createTestHwpx } from '@/test-helpers'
import { readCommand } from './read'

const TEST_FILE = '/tmp/test-read.hwpx'
const TEST_TABLE_FILE = '/tmp/test-read-table.hwpx'
const TEST_HWP_FILE = '/tmp/test-read.hwp'
const TEST_MANY_PARAGRAPHS_FILE = '/tmp/test-read-many.hwpx'

let logs: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

beforeAll(async () => {
  process.env.HWPILOT_NO_DAEMON = '1'

  const buffer = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
  await Bun.write(TEST_FILE, buffer)

  const tableBuffer = await createTestHwpx({
    paragraphs: ['Intro'],
    tables: [
      {
        rows: [
          ['A1', 'B1'],
          ['A2', 'B2'],
        ],
      },
    ],
  })
  await Bun.write(TEST_TABLE_FILE, tableBuffer)

  await Bun.write(TEST_HWP_FILE, createMinimalHwp())

  const manyBuffer = await createTestHwpx({
    paragraphs: ['Para0', 'Para1', 'Para2', 'Para3', 'Para4', 'Para5', 'Para6', 'Para7', 'Para8', 'Para9'],
  })
  await Bun.write(TEST_MANY_PARAGRAPHS_FILE, manyBuffer)
})

afterAll(() => {
  delete process.env.HWPILOT_NO_DAEMON
})

function captureOutput() {
  logs = []
  console.log = (msg: string) => logs.push(msg)
  console.error = (msg: string) => logs.push(msg)
  process.exit = mock(() => {
    throw new Error('process.exit')
  }) as never
}

function restoreOutput() {
  console.log = origLog
  console.error = origError
  process.exit = origExit
}

afterEach(restoreOutput)

describe('readCommand', () => {
  it('reads full document structure', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwpx')
    expect(output.sections).toHaveLength(1)
    expect(output.sections[0].index).toBe(0)
    expect(output.sections[0].paragraphs).toHaveLength(2)
    expect(output.sections[0].paragraphs[0].ref).toBe('s0.p0')
    expect(output.sections[0].paragraphs[0].runs[0].text).toBe('Hello')
    expect(output.sections[0].paragraphs[1].ref).toBe('s0.p1')
    expect(output.sections[0].paragraphs[1].runs[0].text).toBe('World')
    expect(output.header).toBeDefined()
    expect(output.header.fonts).toBeDefined()
    expect(output.header.charShapes).toBeDefined()
  })

  it('reads a single paragraph by ref', async () => {
    captureOutput()
    await readCommand(TEST_FILE, 's0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.runs[0].text).toBe('Hello')
  })

  it('outputs pretty JSON when --pretty', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwpx')
  })

  it('reads table by ref', async () => {
    captureOutput()
    await readCommand(TEST_TABLE_FILE, 's0.t0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0')
    expect(output.rows).toHaveLength(2)
    expect(output.rows[0].cells).toHaveLength(2)
  })

  it('reads table cell by ref', async () => {
    captureOutput()
    await readCommand(TEST_TABLE_FILE, 's0.t0.r0.c0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0.r0.c0')
    expect(output.paragraphs[0].runs[0].text).toBe('A1')
  })

  it('errors for nonexistent file', async () => {
    captureOutput()
    await expect(readCommand('/tmp/nonexistent.hwpx', undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toBeDefined()
  })

  it('reads minimal HWP 5.0 file', async () => {
    captureOutput()
    await readCommand(TEST_HWP_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwp')
    expect(output.sections).toEqual([])
    expect(output.header).toEqual({
      fonts: [],
      charShapes: [],
      paraShapes: [],
      styles: [],
    })
  })

  it('errors for unsupported format', async () => {
    const unsupportedFile = '/tmp/test-read-unsupported.bin'
    await Bun.write(unsupportedFile, Buffer.from('not a valid hwp or hwpx file'))
    captureOutput()
    await expect(readCommand(unsupportedFile, undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('Unsupported file format')
  })

  it('errors for invalid ref', async () => {
    captureOutput()
    await expect(readCommand(TEST_FILE, 'invalid', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('Invalid reference')
  })

  it('paginates paragraphs with --offset and --limit', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 2, limit: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.totalTables).toBe(0)
    expect(section.totalImages).toBe(0)
    expect(section.paragraphs).toHaveLength(3)
    expect(section.paragraphs[0].runs[0].text).toBe('Para2')
    expect(section.paragraphs[1].runs[0].text).toBe('Para3')
    expect(section.paragraphs[2].runs[0].text).toBe('Para4')
  })

  it('paginates with --limit only', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { limit: 2 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(2)
    expect(section.paragraphs[0].runs[0].text).toBe('Para0')
    expect(section.paragraphs[1].runs[0].text).toBe('Para1')
  })

  it('paginates with --offset only', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 8 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(2)
    expect(section.paragraphs[0].runs[0].text).toBe('Para8')
    expect(section.paragraphs[1].runs[0].text).toBe('Para9')
  })

  it('returns empty paragraphs when offset exceeds count', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 100 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(0)
  })

  it('does not include totals without pagination options', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBeUndefined()
    expect(section.totalTables).toBeUndefined()
    expect(section.totalImages).toBeUndefined()
  })

  it('ignores pagination when ref is provided', async () => {
    captureOutput()
    await readCommand(TEST_FILE, 's0.p0', { offset: 5, limit: 10 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.runs[0].text).toBe('Hello')
  })
})

describe('readCommand — text box support', () => {
  const TEST_TB_FILE = '/tmp/test-read-textbox.hwpx'

  beforeAll(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Normal paragraph'],
      textBoxes: [{ text: 'TextBox content' }],
    })
    await Bun.write(TEST_TB_FILE, buffer)
  })

  it('resolves text box ref s0.tb0', async () => {
    captureOutput()
    await readCommand(TEST_TB_FILE, 's0.tb0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.tb0')
    expect(output.paragraphs).toHaveLength(1)
    expect(output.paragraphs[0].runs[0].text).toBe('TextBox content')
  })

  it('resolves text box paragraph ref s0.tb0.p0', async () => {
    captureOutput()
    await readCommand(TEST_TB_FILE, 's0.tb0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toContain('s0.tb0')
    expect(output.runs[0].text).toBe('TextBox content')
  })

  it('includes textBoxes in section output', async () => {
    captureOutput()
    await readCommand(TEST_TB_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.textBoxes).toBeDefined()
    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
  })

  it('includes totalTextBoxes in paginated mode', async () => {
    captureOutput()
    await readCommand(TEST_TB_FILE, undefined, { offset: 0, limit: 10 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalTextBoxes).toBe(1)
  })

  it('errors for nonexistent text box', async () => {
    captureOutput()
    await expect(readCommand(TEST_TB_FILE, 's0.tb5', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('not found')
  })

  it('includes textBoxes in section ref resolution', async () => {
    captureOutput()
    await readCommand(TEST_TB_FILE, 's0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.textBoxes).toBeDefined()
    expect(output.textBoxes).toHaveLength(1)
  })
})

describe('readCommand — heading level and style name resolution', () => {
  const TEST_HEADING_FILE = '/tmp/test-read-heading.hwpx'

  beforeAll(async () => {
    // Create a test document with heading styles
    const zip = new (await import('jszip')).default()

    zip.file(
      'version.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"
  major="5" minor="1" micro="0" buildNumber="0"/>`
    )

    zip.file(
      'META-INF/manifest.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/>
  <manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="Contents/section0.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
    )

    zip.file(
      'Contents/content.hpf',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">
  <opf:manifest>
    <opf:item id="header" href="header.xml" media-type="text/xml"/>
    <opf:item id="section0" href="section0.xml" media-type="text/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0"/>
  </opf:spine>
</opf:package>`
    )

    // Header with heading style (id=1) and body style (id=0)
    zip.file(
      'Contents/header.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces>
      <hh:fontface hh:id="0" hh:face="맑은 고딕"/>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr hh:id="0" hh:height="1000" hh:fontRef="0"
        hh:fontBold="0" hh:fontItalic="0" hh:underline="0" hh:color="0"/>
    </hh:charProperties>
    <hh:paraProperties>
      <hh:paraPr hh:id="0" hh:align="JUSTIFY"/>
      <hh:paraPr hh:id="1" hh:align="LEFT">
        <hh:heading hh:type="OUTLINE" hh:idRef="0" hh:level="1"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:styles>
      <hh:style hh:id="0" hh:name="Normal" hh:charPrIDRef="0" hh:paraPrIDRef="0"/>
      <hh:style hh:id="1" hh:name="Heading 1" hh:charPrIDRef="0" hh:paraPrIDRef="1" hh:type="PARA"/>
    </hh:styles>
  </hh:refList>
</hh:head>`
    )

    // Section with two paragraphs: one with heading style, one with body style
    zip.file(
      'Contents/section0.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"
        xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hp:p hp:id="0" hp:paraPrIDRef="1" hp:styleIDRef="1">
    <hp:run hp:charPrIDRef="0"><hp:t>Heading Text</hp:t></hp:run>
  </hp:p>
  <hp:p hp:id="1" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>Body Text</hp:t></hp:run>
  </hp:p>
</hs:sec>`
    )

    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await Bun.write(TEST_HEADING_FILE, buffer)
  })

  it('includes headingLevel and styleName for heading style paragraph', async () => {
    captureOutput()
    await readCommand(TEST_HEADING_FILE, 's0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.headingLevel).toBe(1)
    expect(output.styleName).toBe('Heading 1')
  })

  it('includes styleName but no headingLevel for body style paragraph', async () => {
    captureOutput()
    await readCommand(TEST_HEADING_FILE, 's0.p1', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p1')
    expect(output.headingLevel).toBeUndefined()
    expect(output.styleName).toBe('Normal')
  })

  it('includes heading and style info in full document read', async () => {
    captureOutput()
    await readCommand(TEST_HEADING_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.paragraphs).toHaveLength(2)

    // First paragraph: heading
    expect(section.paragraphs[0].headingLevel).toBe(1)
    expect(section.paragraphs[0].styleName).toBe('Heading 1')

    // Second paragraph: body
    expect(section.paragraphs[1].headingLevel).toBeUndefined()
    expect(section.paragraphs[1].styleName).toBe('Normal')
  })
})

function createMinimalHwp(): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}
