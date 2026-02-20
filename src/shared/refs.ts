export type ParsedRef = {
  section: number
  paragraph?: number
  run?: number
  table?: number
  row?: number
  cell?: number
  cellParagraph?: number
  image?: number
}

const REF_PATTERN = /^s(\d+)(?:\.(?:p(\d+)(?:\.r(\d+))?|t(\d+)(?:\.r(\d+)\.c(\d+)(?:\.p(\d+))?)?|img(\d+)))?$/

export function validateRef(ref: string): boolean {
  if (!ref || typeof ref !== 'string') {
    return false
  }
  return REF_PATTERN.test(ref)
}

export function parseRef(ref: string): ParsedRef {
  if (!validateRef(ref)) {
    throw new Error(`Invalid reference: ${ref}`)
  }

  const match = ref.match(REF_PATTERN)
  if (!match) {
    throw new Error(`Invalid reference: ${ref}`)
  }

  const result: ParsedRef = {
    section: parseInt(match[1], 10),
  }

  if (match[2] !== undefined) {
    result.paragraph = parseInt(match[2], 10)
  }

  if (match[3] !== undefined) {
    result.run = parseInt(match[3], 10)
  }

  if (match[4] !== undefined) {
    result.table = parseInt(match[4], 10)
  }

  if (match[5] !== undefined) {
    result.row = parseInt(match[5], 10)
  }

  if (match[6] !== undefined) {
    result.cell = parseInt(match[6], 10)
  }

  if (match[7] !== undefined) {
    result.cellParagraph = parseInt(match[7], 10)
  }

  if (match[8] !== undefined) {
    result.image = parseInt(match[8], 10)
  }

  return result
}

export function buildRef(parts: ParsedRef): string {
  let ref = `s${parts.section}`

  if (parts.image !== undefined) {
    ref += `.img${parts.image}`
  } else if (parts.table !== undefined) {
    ref += `.t${parts.table}`
    if (parts.row !== undefined && parts.cell !== undefined) {
      ref += `.r${parts.row}.c${parts.cell}`
      if (parts.cellParagraph !== undefined) {
        ref += `.p${parts.cellParagraph}`
      }
    }
  } else if (parts.paragraph !== undefined) {
    ref += `.p${parts.paragraph}`
    if (parts.run !== undefined) {
      ref += `.r${parts.run}`
    }
  }

  return ref
}
