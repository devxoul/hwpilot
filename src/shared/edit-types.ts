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
  | { type: 'setFormat'; ref: string; format: FormatOptions }
  | { type: 'setTableCell'; ref: string; text: string }
  | { type: 'addTable'; ref: string; rows: number; cols: number; data?: string[][] }

export type XmlNode = Record<string, unknown>
