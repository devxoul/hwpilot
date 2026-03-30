import type CFB from 'cfb'

const SECTOR_SIZE = 512
const MINI_SECTOR_SIZE = 64
const MINI_STREAM_CUTOFF = 4096
const END_OF_CHAIN = -2
const FREE_SECT = -1
const FAT_SECT = -3
const NOSTREAM = -1

type TreeNode = {
  name: string
  type: number
  content: Uint8Array | null
  children: TreeNode[]
  dirIndex: number
  left: number
  right: number
  child: number
  color: number
}

export function writeCfb(cfb: CFB.CFB$Container): Buffer {
  const entries = collectEntries(cfb)
  const tree = buildDirectoryTree(entries)
  const flatEntries = flattenTree(tree)

  const { miniStreams, regularStreams } = categorizeStreams(flatEntries)

  const miniStreamData = buildMiniStreamData(miniStreams)
  const miniStreamSectors = Math.ceil(miniStreamData.length / SECTOR_SIZE)

  const miniFatEntries = buildMiniFat(miniStreams)
  const miniFatSectors = Math.max(1, Math.ceil(miniFatEntries.length / (SECTOR_SIZE / 4)))

  const dirSectors = Math.ceil((flatEntries.length * 128) / SECTOR_SIZE)

  const regularStreamSectorCounts = regularStreams.map((s) => Math.ceil((s.content?.length ?? 0) / SECTOR_SIZE))
  const totalRegularStreamSectors = regularStreamSectorCounts.reduce((a, b) => a + b, 0)

  const dataSectors = dirSectors + miniFatSectors + miniStreamSectors + totalRegularStreamSectors
  const entriesPerFatSector = SECTOR_SIZE / 4
  let fatSectors = Math.ceil((dataSectors + 1) / entriesPerFatSector)
  while (fatSectors + dataSectors > fatSectors * entriesPerFatSector) {
    fatSectors++
  }
  const finalTotalSectors = fatSectors + dataSectors

  const fat = new Int32Array(Math.max(finalTotalSectors, fatSectors * (SECTOR_SIZE / 4)))
  fat.fill(-1)

  let nextSector = 0

  const fatSectorIndices: number[] = []
  for (let i = 0; i < fatSectors; i++) {
    fatSectorIndices.push(nextSector)
    fat[nextSector] = FAT_SECT
    nextSector++
  }

  const dirSectorStart = nextSector
  for (let i = 0; i < dirSectors; i++) {
    fat[nextSector] = i < dirSectors - 1 ? nextSector + 1 : END_OF_CHAIN
    nextSector++
  }

  const miniFatSectorStart = nextSector
  for (let i = 0; i < miniFatSectors; i++) {
    fat[nextSector] = i < miniFatSectors - 1 ? nextSector + 1 : END_OF_CHAIN
    nextSector++
  }

  const miniStreamSectorStart = nextSector
  for (let i = 0; i < miniStreamSectors; i++) {
    fat[nextSector] = i < miniStreamSectors - 1 ? nextSector + 1 : END_OF_CHAIN
    nextSector++
  }

  const regularSectorStarts: number[] = []
  for (let si = 0; si < regularStreams.length; si++) {
    regularSectorStarts.push(nextSector)
    const count = regularStreamSectorCounts[si]
    for (let i = 0; i < count; i++) {
      fat[nextSector] = i < count - 1 ? nextSector + 1 : END_OF_CHAIN
      nextSector++
    }
  }

  const fileSectors = nextSector
  const fileSize = (1 + fileSectors) * SECTOR_SIZE
  const output = Buffer.alloc(fileSize)

  writeHeader(output, {
    fatSectors,
    fatSectorIndices,
    dirSectorStart,
    miniFatSectorStart,
    miniFatSectors,
  })

  for (let i = 0; i < fatSectors; i++) {
    const sectorOffset = (fatSectorIndices[i] + 1) * SECTOR_SIZE
    const startEntry = i * (SECTOR_SIZE / 4)
    for (let j = 0; j < SECTOR_SIZE / 4; j++) {
      const idx = startEntry + j
      const val = idx < fat.length ? fat[idx] : -1
      output.writeInt32LE(val, sectorOffset + j * 4)
    }
  }

  writeDirectoryEntries(output, flatEntries, dirSectorStart, {
    miniStreamSectorStart: miniStreamData.length > 0 ? miniStreamSectorStart : END_OF_CHAIN,
    miniStreamSize: miniStreamData.length,
    regularSectorStarts,
    regularStreams,
    miniStreams,
  })

  writeMiniFat(output, miniFatEntries, miniFatSectorStart)

  if (miniStreamData.length > 0) {
    miniStreamData.copy(output, (miniStreamSectorStart + 1) * SECTOR_SIZE)
  }

  for (let si = 0; si < regularStreams.length; si++) {
    const data = regularStreams[si].content
    if (data && data.length > 0) {
      Buffer.from(data).copy(output, (regularSectorStarts[si] + 1) * SECTOR_SIZE)
    }
  }

  return output
}

type CfbEntry = {
  name: string
  fullPath: string
  type: number
  content: Uint8Array | null
}

function collectEntries(cfb: CFB.CFB$Container): CfbEntry[] {
  const result: CfbEntry[] = []
  for (const entry of cfb.FileIndex) {
    if (entry.type === 0) continue
    if (entry.name === '\u0001Sh33tJ5') continue

    result.push({
      name: entry.name,
      fullPath: (cfb.FullPaths[cfb.FileIndex.indexOf(entry)] ?? '').replace(/\/$/, ''),
      type: entry.type,
      content: entry.type === 2 && entry.content ? new Uint8Array(entry.content) : null,
    })
  }
  return result
}

function cfbNameCompare(a: string, b: string): number {
  const aUp = a.toUpperCase()
  const bUp = b.toUpperCase()
  if (aUp.length !== bUp.length) return aUp.length - bUp.length
  if (aUp < bUp) return -1
  if (aUp > bUp) return 1
  return 0
}

function buildDirectoryTree(entries: CfbEntry[]): TreeNode {
  const pathMap = new Map<string, TreeNode>()
  const root = entries.find((e) => e.type === 5)
  if (!root) throw new Error('No root entry')

  const rootNode: TreeNode = {
    name: root.name,
    type: root.type,
    content: null,
    children: [],
    dirIndex: -1,
    left: NOSTREAM,
    right: NOSTREAM,
    child: NOSTREAM,
    color: 0,
  }
  pathMap.set(root.fullPath, rootNode)

  const storages = entries.filter((e) => e.type === 1)
  for (const s of storages) {
    const parts = s.fullPath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const node: TreeNode = {
      name: s.name,
      type: s.type,
      content: null,
      children: [],
      dirIndex: -1,
      left: NOSTREAM,
      right: NOSTREAM,
      child: NOSTREAM,
      color: 0,
    }
    pathMap.set(s.fullPath, node)
    const parent = pathMap.get(parentPath)
    if (parent) parent.children.push(node)
  }

  const streams = entries.filter((e) => e.type === 2)
  for (const s of streams) {
    const parts = s.fullPath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const node: TreeNode = {
      name: s.name,
      type: s.type,
      content: s.content,
      children: [],
      dirIndex: -1,
      left: NOSTREAM,
      right: NOSTREAM,
      child: NOSTREAM,
      color: 0,
    }
    const parent = pathMap.get(parentPath)
    if (parent) parent.children.push(node)
  }

  return rootNode
}

function flattenTree(root: TreeNode): TreeNode[] {
  const result: TreeNode[] = []
  let index = 0

  function assign(node: TreeNode): void {
    node.dirIndex = index++
    result.push(node)
  }

  function buildBst(sorted: TreeNode[]): TreeNode | null {
    if (sorted.length === 0) return null

    const mid = Math.floor(sorted.length / 2)
    const midNode = sorted[mid]

    assign(midNode)

    // Process midNode's own children (storages)
    if (midNode.children.length > 0) {
      midNode.children.sort((a, b) => cfbNameCompare(a.name, b.name))
      const childRoot = buildBst(midNode.children)
      if (childRoot) midNode.child = childRoot.dirIndex
    }

    const leftArr = sorted.slice(0, mid)
    const rightArr = sorted.slice(mid + 1)

    const leftChild = buildBst(leftArr)
    const rightChild = buildBst(rightArr)

    midNode.left = leftChild ? leftChild.dirIndex : NOSTREAM
    midNode.right = rightChild ? rightChild.dirIndex : NOSTREAM
    midNode.color = 1 // black

    return midNode
  }

  // Root entry is always first (index 0)
  assign(root)
  root.color = 1

  if (root.children.length > 0) {
    root.children.sort((a, b) => cfbNameCompare(a.name, b.name))
    const childRoot = buildBst(root.children)
    if (childRoot) root.child = childRoot.dirIndex
  }

  return result
}

function categorizeStreams(entries: TreeNode[]): {
  miniStreams: TreeNode[]
  regularStreams: TreeNode[]
} {
  const miniStreams: TreeNode[] = []
  const regularStreams: TreeNode[] = []

  for (const entry of entries) {
    if (entry.type !== 2) continue
    const size = entry.content?.length ?? 0
    if (size === 0) continue

    if (size < MINI_STREAM_CUTOFF) {
      miniStreams.push(entry)
    } else {
      regularStreams.push(entry)
    }
  }

  return { miniStreams, regularStreams }
}

function buildMiniStreamData(miniStreams: TreeNode[]): Buffer {
  if (miniStreams.length === 0) return Buffer.alloc(0)

  let totalMiniSectors = 0
  for (const s of miniStreams) {
    const size = s.content?.length ?? 0
    totalMiniSectors += Math.ceil(size / MINI_SECTOR_SIZE)
  }

  const buf = Buffer.alloc(Math.ceil((totalMiniSectors * MINI_SECTOR_SIZE) / SECTOR_SIZE) * SECTOR_SIZE)
  let offset = 0
  for (const s of miniStreams) {
    if (s.content && s.content.length > 0) {
      Buffer.from(s.content).copy(buf, offset)
      offset += Math.ceil(s.content.length / MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE
    }
  }

  return buf
}

function buildMiniFat(miniStreams: TreeNode[]): number[] {
  const entries: number[] = []
  for (const s of miniStreams) {
    const size = s.content?.length ?? 0
    const sectors = Math.ceil(size / MINI_SECTOR_SIZE)
    const startIdx = entries.length
    for (let i = 0; i < sectors; i++) {
      entries.push(i < sectors - 1 ? startIdx + i + 1 : END_OF_CHAIN)
    }
  }
  return entries
}

function writeHeader(
  buf: Buffer,
  opts: {
    fatSectors: number
    fatSectorIndices: number[]
    dirSectorStart: number
    miniFatSectorStart: number
    miniFatSectors: number
  },
): void {
  buf.fill(0, 0, SECTOR_SIZE)

  // Magic
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0)
  // CLSID (16 bytes of zeros) at 0x08
  // Minor version
  buf.writeUInt16LE(0x003e, 0x18)
  // Major version
  buf.writeUInt16LE(0x0003, 0x1a)
  // Byte order
  buf.writeUInt16LE(0xfffe, 0x1c)
  // Sector size power
  buf.writeUInt16LE(0x0009, 0x1e)
  // Mini sector size power
  buf.writeUInt16LE(0x0006, 0x20)
  // Reserved (6 bytes of zeros at 0x22)
  // Total directory sectors (v3: must be 0)
  buf.writeUInt32LE(0, 0x28)
  // Total FAT sectors
  buf.writeUInt32LE(opts.fatSectors, 0x2c)
  // First directory sector
  buf.writeUInt32LE(opts.dirSectorStart, 0x30)
  // Transaction signature (0)
  buf.writeUInt32LE(0, 0x34)
  // Mini stream cutoff
  buf.writeUInt32LE(MINI_STREAM_CUTOFF, 0x38)
  // First mini-FAT sector
  buf.writeUInt32LE(opts.miniFatSectorStart, 0x3c)
  // Number of mini-FAT sectors
  buf.writeUInt32LE(opts.miniFatSectors, 0x40)
  // First DIFAT sector
  writeInt32(buf, END_OF_CHAIN, 0x44)
  // Number of DIFAT sectors
  buf.writeUInt32LE(0, 0x48)

  // DIFAT array (109 entries starting at 0x4C)
  for (let i = 0; i < 109; i++) {
    writeInt32(buf, i < opts.fatSectorIndices.length ? opts.fatSectorIndices[i] : FREE_SECT, 0x4c + i * 4)
  }
}

function writeDirectoryEntries(
  buf: Buffer,
  entries: TreeNode[],
  dirSectorStart: number,
  streamInfo: {
    miniStreamSectorStart: number
    miniStreamSize: number
    regularSectorStarts: number[]
    regularStreams: TreeNode[]
    miniStreams: TreeNode[]
  },
): void {
  const dirOffset = (dirSectorStart + 1) * SECTOR_SIZE
  const totalSlots = Math.ceil(entries.length / 4) * 4

  // Zero out all directory sectors
  const dirSize = totalSlots * 128
  buf.fill(0, dirOffset, dirOffset + dirSize)

  // Track mini-stream sector allocation
  let miniSectorCursor = 0

  // Build map for regular stream start sectors
  const regularStartMap = new Map<TreeNode, number>()
  for (let i = 0; i < streamInfo.regularStreams.length; i++) {
    regularStartMap.set(streamInfo.regularStreams[i], streamInfo.regularSectorStarts[i])
  }

  // Build map for mini-stream start sectors
  const miniStartMap = new Map<TreeNode, number>()
  for (const s of streamInfo.miniStreams) {
    miniStartMap.set(s, miniSectorCursor)
    miniSectorCursor += Math.ceil((s.content?.length ?? 0) / MINI_SECTOR_SIZE)
  }

  for (let i = 0; i < totalSlots; i++) {
    const entryOffset = dirOffset + i * 128
    if (i >= entries.length) {
      // Free entry
      buf.fill(0, entryOffset, entryOffset + 128)
      // Left/right/child = NOSTREAM
      writeInt32(buf, NOSTREAM, entryOffset + 0x44)
      writeInt32(buf, NOSTREAM, entryOffset + 0x48)
      writeInt32(buf, NOSTREAM, entryOffset + 0x4c)
      continue
    }

    const entry = entries[i]
    const nameBuf = Buffer.from(entry.name + '\0', 'utf16le')
    nameBuf.copy(buf, entryOffset, 0, Math.min(nameBuf.length, 64))

    // Name size (bytes, including null terminator)
    buf.writeUInt16LE(Math.min(nameBuf.length, 64), entryOffset + 0x40)
    // Object type
    buf.writeUInt8(entry.type, entryOffset + 0x42)
    // Color (0 = red, 1 = black)
    buf.writeUInt8(entry.color, entryOffset + 0x43)
    // Left sibling
    writeInt32(buf, entry.left, entryOffset + 0x44)
    // Right sibling
    writeInt32(buf, entry.right, entryOffset + 0x48)
    // Child
    writeInt32(buf, entry.child, entryOffset + 0x4c)

    // CLSID (16 bytes of zeros at 0x50)
    // State bits (0 at 0x60)

    if (entry.type === 5) {
      // Root Entry
      writeInt32(
        buf,
        streamInfo.miniStreamSize > 0 ? streamInfo.miniStreamSectorStart : END_OF_CHAIN,
        entryOffset + 0x74,
      )
      buf.writeUInt32LE(streamInfo.miniStreamSize, entryOffset + 0x78)
    } else if (entry.type === 2) {
      const size = entry.content?.length ?? 0
      if (size === 0) {
        writeInt32(buf, END_OF_CHAIN, entryOffset + 0x74)
        buf.writeUInt32LE(0, entryOffset + 0x78)
      } else if (size < MINI_STREAM_CUTOFF) {
        const start = miniStartMap.get(entry) ?? END_OF_CHAIN
        writeInt32(buf, start, entryOffset + 0x74)
        buf.writeUInt32LE(size, entryOffset + 0x78)
      } else {
        const start = regularStartMap.get(entry) ?? END_OF_CHAIN
        writeInt32(buf, start, entryOffset + 0x74)
        buf.writeUInt32LE(size, entryOffset + 0x78)
      }
    } else if (entry.type === 1) {
      // Storage
      buf.writeUInt32LE(0, entryOffset + 0x74)
      buf.writeUInt32LE(0, entryOffset + 0x78)
    }
  }
}

function writeMiniFat(buf: Buffer, miniFatEntries: number[], miniFatSectorStart: number): void {
  const offset = (miniFatSectorStart + 1) * SECTOR_SIZE
  const totalSlots = Math.ceil(Math.max(miniFatEntries.length, 1) / (SECTOR_SIZE / 4)) * (SECTOR_SIZE / 4)

  for (let i = 0; i < totalSlots; i++) {
    const val = i < miniFatEntries.length ? miniFatEntries[i] : FREE_SECT
    writeInt32(buf, val, offset + i * 4)
  }
}

function writeInt32(buf: Buffer, value: number, offset: number): void {
  buf.writeInt32LE(value, offset)
}
