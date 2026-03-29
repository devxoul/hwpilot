// Canonical STYLE record parser shared by reader, mutator, validator, and creator.
// STYLE record layout:
//   [uint16 koreanNameLen][koreanName (UTF-16LE)][uint16 englishNameLen][englishName (UTF-16LE)]
//   followed by either:
//   - Extended format (remaining >= 10): [4 bytes padding][uint16 charShapeRef][uint16 paraShapeRef]
//   - Short format   (remaining >= 4):                    [uint16 charShapeRef][uint16 paraShapeRef]
export function parseStyleRefs(data: Buffer): { charShapeRef: number; paraShapeRef: number } | null {
  if (data.length < 2) return null
  const nameLen = data.readUInt16LE(0)
  let offset = 2 + nameLen * 2
  if (offset + 2 > data.length) return null
  const englishNameLen = data.readUInt16LE(offset)
  offset += 2 + englishNameLen * 2
  const remaining = data.length - offset
  if (remaining >= 10) {
    return {
      charShapeRef: data.readUInt16LE(offset + 4),
      paraShapeRef: data.readUInt16LE(offset + 6),
    }
  }
  if (remaining >= 4) {
    return {
      charShapeRef: data.readUInt16LE(offset),
      paraShapeRef: data.readUInt16LE(offset + 2),
    }
  }
  return null
}
