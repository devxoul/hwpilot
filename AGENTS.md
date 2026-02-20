# Agent HWP — Development Guide

## Overview

Agent HWP is a native HWP/HWPX document editor CLI for AI agents. It provides programmatic access to read and write Korean word processor documents.

## TypeScript Execution Model

### Development (Bun)
During development, run TypeScript directly with Bun:
```bash
bun src/cli.ts <command> [options]
```

Bun handles TypeScript compilation on-the-fly, enabling fast iteration.

### Production (Node.js)
For distribution, compile to JavaScript and run with Node.js:
```bash
bun run build
node dist/src/cli.js <command> [options]
```

The build pipeline:
1. `tsc` compiles TypeScript to JavaScript in `dist/`
2. `tsc-alias` resolves path aliases (`@/*` → `src/*`)
3. `postbuild.ts` replaces shebangs (`#!/usr/bin/env bun` → `#!/usr/bin/env node`)
4. `prepublish.ts` rewrites bin paths in package.json for npm publishing

## Project Structure

```
src/
├── cli.ts                 # CLI entry point
├── commands/              # Command implementations
│   ├── read.ts
│   ├── write.ts
│   └── ...
├── formats/
│   ├── hwpx/              # HWPX format (ZIP+XML)
│   │   ├── reader.ts
│   │   ├── writer.ts
│   │   └── ...
│   └── hwp/               # HWP 5.0 format (binary CFB, read-only)
│       ├── reader.ts
│       └── ...
└── shared/                # Shared utilities
    ├── types.ts
    ├── constants.ts
    └── ...

scripts/
├── postbuild.ts           # Post-build shebang replacement
└── prepublish.ts          # Pre-publish bin path rewriting

skills/hwp/                # Claude skill definition
└── SKILL.md

.claude-plugin/            # Claude plugin metadata
```

## Build Pipeline

### Development Build
```bash
bun run typecheck    # Type-check without emitting
bun run lint         # Lint with Biome
```

### Production Build
```bash
bun run build        # Compile + alias resolution + postbuild
```

Output: `dist/src/cli.js` (executable with Node.js)

### Publishing
```bash
bun run prepublishOnly   # Build + rewrite bin paths
npm publish
bun run postpublish      # Restore package.json
```

## Test Commands

```bash
bun test src/        # Run all tests in src/
bun run typecheck    # Type-check
bun run lint         # Lint
bun run lint:fix     # Auto-fix lint issues
bun run format       # Format code
```

## HWP/HWPX Format Overview

### HWPX (Recommended for R/W)
- **Structure**: ZIP archive containing XML files
- **Capabilities**: Full read/write support
- **Key files**:
  - `content.xml` — document content
  - `styles.xml` — styles and formatting
  - `meta.xml` — metadata
  - `settings.xml` — document settings
- **Advantages**: Human-readable, extensible, modern

### HWP 5.0 (Read-Only)
- **Structure**: Compound File Binary (CFB) format
- **Capabilities**: Read-only (binary format is complex)
- **Key sections**:
  - `FileHeader` — document metadata
  - `BodyText` — document content
  - `DocInfo` — styles and formatting
- **Note**: Full write support requires reverse-engineering binary format

## Reference System

Documents use a hierarchical reference notation: `s0.p0`, `s0.t1.r2.c0`

- `s` = section (0-indexed)
- `p` = paragraph
- `t` = table
- `r` = row
- `c` = cell

Example: `s0.t1.r2.c0` = Section 0, Table 1, Row 2, Cell 0

## Adding New Commands

1. Create `src/commands/<name>.ts`:
```typescript
export async function <name>(options: CommandOptions): Promise<void> {
  // Implementation
}
```

2. Register in `src/cli.ts`:
```typescript
import { <name> } from '@/commands/<name>'

program
  .command('<name>')
  .description('...')
  .action(<name>)
```

3. Test with:
```bash
bun src/cli.ts <name> [options]
```

## Key Dependencies

- **jszip** — ZIP file handling (HWPX format)
- **fast-xml-parser** — XML parsing and generation
- **commander** — CLI argument parsing
- **typescript** — Type checking
- **@biomejs/biome** — Linting and formatting

## Development Workflow

1. **Type-check**: `bun run typecheck`
2. **Lint**: `bun run lint`
3. **Test**: `bun test src/`
4. **Build**: `bun run build`
5. **Run**: `node dist/src/cli.js <command>`

## Troubleshooting

### Build fails with "Cannot find module"
- Run `bun install` to ensure dependencies are installed
- Check that path aliases in `tsconfig.json` match your file structure

### Lint errors
- Run `bun run lint:fix` to auto-fix common issues
- Check `biome.json` for rule configuration

### Type errors
- Run `bun run typecheck` to see all type issues
- Ensure all imports use correct paths with `@/` alias
