export const PATHS = {
  VERSION_XML: 'version.xml',
  HEADER_XML: 'Contents/header.xml',
  CONTENT_HPF: 'Contents/content.hpf',
  MANIFEST_XML: 'META-INF/manifest.xml',
  BIN_DATA_DIR: 'BinData/',
} as const

export function sectionPath(n: number): string {
  return `Contents/section${n}.xml`
}
