# Agent HWP

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

# Write to a document
hwp write document.hwpx --content "Hello, World!"

# Extract text
hwp extract document.hwpx --output text.txt

# Convert format
hwp convert document.hwp --to hwpx --output document.hwpx
```

## Features

- **HWPX Read/Write**: Full support for modern HWPX format (ZIP+XML)
- **HWP Read-Only**: Read legacy HWP 5.0 binary format
- **Reference System**: Navigate documents using hierarchical references (s0.p0, s0.t1.r2.c0)
- **Table Support**: Read and modify table structures
- **Image Handling**: Extract and embed images
- **Metadata**: Access and modify document metadata
- **Styles**: Read and apply formatting styles
- **AI-Friendly**: Designed for programmatic access by AI agents

## CLI Reference

| Command | Description |
|---------|-------------|
| `hwp read <file>` | Read and display document content |
| `hwp write <file>` | Write content to document |
| `hwp extract <file>` | Extract text from document |
| `hwp convert <file>` | Convert between HWP and HWPX formats |
| `hwp info <file>` | Display document metadata |
| `hwp validate <file>` | Validate document structure |

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

## License

MIT
