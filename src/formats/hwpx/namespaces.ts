export const NAMESPACES = {
  hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  ha: 'http://www.hancom.co.kr/hwpml/2011/app',
  hv: 'http://www.hancom.co.kr/hwpml/2011/version',
  hpf: 'http://www.hancom.co.kr/schema/2011/hpf',
  hp10: 'http://www.hancom.co.kr/hwpml/2016/paragraph',
  odf: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  ocf: 'urn:oasis:names:tc:opendocument:xmlns:container',
  opf: 'http://www.idpf.org/2007/opf/',
} as const

export type NamespacePrefix = keyof typeof NAMESPACES
