# hwpcli

Native HWP/HWPX document editor CLI for AI agents. Read and write Korean word processor documents programmatically.

## Installation

```bash
# Via npm
npm install -g hwp

# Via bun
bun add -g hwp
```

## Quick Start

```bash
# Read a document
hwp read document.hwpx

# Extract text
hwp text document.hwpx

# Edit text in-place
hwp edit text document.hwpx s0.p0 "Hello, World!"

# Convert HWP to HWPX
hwp convert document.hwp document.hwpx
```

## Features

- **HWPX Read/Write**: Full support for modern HWPX format (ZIP+XML)
- **HWP Read/Write**: Read and edit HWP 5.0 binary format (text, tables, formatting)
- **Reference System**: Navigate documents using hierarchical references (s0.p0, s0.t1.r2.c0)
- **Table Support**: Read and modify table structures
- **Image Handling**: Extract and embed images
- **Metadata**: Access and modify document metadata
- **Styles**: Read and apply formatting styles
- **AI-Friendly**: Designed for programmatic access by AI agents

## CLI Reference

| Command | Description |
|---------|-------------|
| `hwp read <file> [ref]` | Read document structure |
| `hwp text <file> [ref]` | Extract text |
| `hwp edit text <file> <ref> <text>` | Edit text in-place |
| `hwp edit format <file> <ref> [options]` | Edit character formatting |
| `hwp table read <file> <ref>` | Read table structure |
| `hwp table edit <file> <ref> <text>` | Edit table cell |
| `hwp table list <file>` | List all tables |
| `hwp image list <file>` | List embedded images |
| `hwp image extract <file> <ref> <output>` | Extract image |
| `hwp image insert <file> <image-path>` | Insert image |
| `hwp image replace <file> <ref> <image-path>` | Replace image |
| `hwp create <file> [--title <text>] [--font <name>] [--size <pt>]` | Create new document |
| `hwp convert <input.hwp> <output.hwpx>` | Convert HWP to HWPX |

## Development

See [AGENTS.md](./AGENTS.md) for development guide.

```bash
# Install dependencies
bun install

# Type-check
bun run typecheck

# Lint
bun run lint

# Build
bun run build

# Test
bun test src/
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## Acknowledgments

- [Hancom OWPML spec (KS X 6101)](http://www.hancom.co.kr) — HWPX format specification
- [hwp.js](https://github.com/hahnlee/hwp.js) — Open source HWP parser that served as a reference for understanding the HWP 5.0 binary format

## License

MIT
