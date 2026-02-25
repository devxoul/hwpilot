export type FormatOptions = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontName?: string
  fontSize?: number
  color?: string
}

export type EditOperation =
  | { type: 'setText'; ref: string; text: string }
  | { type: 'setFormat'; ref: string; format: FormatOptions; start?: number; end?: number }
  | { type: 'setTableCell'; ref: string; text: string }
  | { type: 'addTable'; ref: string; rows: number; cols: number; data?: string[][] }
  | { type: 'addParagraph'; ref: string; text: string; position: 'before' | 'after' | 'end'; format?: FormatOptions }

export type XmlNode = Record<string, unknown>
