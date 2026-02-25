# hwpilot

[![한국어](https://img.shields.io/badge/lang-한국어-blue)](./README.md)

Native CLI for reading and writing HWP/HWPX documents. Built for AI agents that need to work with Korean word processor files programmatically.

All commands output JSON. All edits happen in-place.

## Install

```bash
npm install -g hwpilot
```

## Usage

```bash
# Read first 20 paragraphs
hwpilot read document.hwpx --limit 20

# Search for text
hwpilot find document.hwpx "청구취지"

# Edit a paragraph
hwpilot edit text document.hwpx s0.p0 "New content"

# Edit a table cell
hwpilot table edit document.hwpx s0.t0.r0.c0 "Cell value"

# Add a 3×4 table
hwpilot table add document.hwpx 3 4

# Add a table with data
hwpilot table add document.hwpx 2 2 --data '[["A","B"],["C","D"]]'

# Bold + resize
hwpilot edit format document.hwpx s0.p0 --bold --size 16

# Convert HWP 5.0 → HWPX
hwpilot convert legacy.hwp output.hwpx
```

## Reference System

Every element in a document is addressed by a hierarchical ref. Indices are 0-based.

```
s{N}                    → Section
s{N}.p{M}               → Paragraph
s{N}.p{M}.r{K}          → Run (text span with uniform formatting)
s{N}.t{M}               → Table
s{N}.t{M}.r{R}.c{C}     → Table cell
s{N}.t{M}.r{R}.c{C}.p{P} → Paragraph inside a table cell
s{N}.tb{M}              → Text box
s{N}.tb{M}.p{P}         → Paragraph inside a text box
s{N}.img{M}             → Image
```

Examples:
- `s0.p0` — first paragraph
- `s0.t0.r1.c2` — table 0, row 1, cell 2
- `s0.tb0.p0` — first paragraph inside first text box

## Commands

### read

Read document structure. Use `--offset` and `--limit` to paginate.

```bash
hwpilot read <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwpilot read report.hwpx --limit 20          # first 20 paragraphs
hwpilot read report.hwpx --offset 20 --limit 20  # next 20
hwpilot read report.hwpx s0.t0               # a specific table
```

### text

Extract plain text.

```bash
hwpilot text <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwpilot text report.hwpx                     # all text
hwpilot text report.hwpx s0.p0               # one paragraph
hwpilot text report.hwpx s0.t0.r0.c0         # a table cell
```

### find

Search text across all containers (paragraphs, tables, text boxes). Case-insensitive.

```bash
hwpilot find <file> <query> [--json]
```

```bash
hwpilot find document.hwpx "청구취지"
# s0.p3: 청구취지
# s0.tb0.p0: 청구취지 및 청구원인

hwpilot find document.hwpx "청구취지" --json
# {"matches":[{"ref":"s0.p3","text":"청구취지","container":"paragraph"},...]}
```

### edit text

Replace text at a ref. Modifies the file in-place.

```bash
hwpilot edit text <file> <ref> <text> [--pretty]
```

```bash
hwpilot edit text report.hwpx s0.p0 "New Title"
hwpilot edit text report.hwpx s0.t0.r0.c0 "Cell value"
hwpilot edit text report.hwpx s0.tb0.p0 "Text box content"
```

### edit format

Change character formatting at a ref.

```bash
hwpilot edit format <file> <ref> [options] [--pretty]
```

| Flag | Effect |
|---|---|
| `--bold` / `--no-bold` | Toggle bold |
| `--italic` / `--no-italic` | Toggle italic |
| `--underline` / `--no-underline` | Toggle underline |
| `--font <name>` | Set font |
| `--size <pt>` | Set font size |
| `--color <hex>` | Set text color (e.g. `#FF0000`) |

```bash
hwpilot edit format report.hwpx s0.p0 --bold --size 16 --font "맑은 고딕"
hwpilot edit format report.hwpx s0.p1 --italic --color "#0000FF"
```

### table read

Read a table's structure (rows, cells, text).

```bash
hwpilot table read <file> <ref> [--pretty]
```

### table edit

Edit text in a table cell.

```bash
hwpilot table edit <file> <ref> <text> [--pretty]
```

```bash
hwpilot table edit report.hwpx s0.t0.r0.c0 "Name"
hwpilot table edit report.hwpx s0.t0.r0.c1 "Date"
```

### table add

Add a new table to the document.

```bash
hwpilot table add <file> <rows> <cols> [--data <json>] [--pretty]
```

```bash
hwpilot table add report.hwpx 3 4
hwpilot table add report.hwpx 2 2 --data '[["Name","Date"],["Alice","2025-01-01"]]'
```
### table list

List all tables in the document.

```bash
hwpilot table list <file> [--pretty]
```

### image list / extract / insert / replace

```bash
hwpilot image list <file>                            # list all images
hwpilot image extract <file> <ref> <output-path>     # extract to file
hwpilot image insert <file> <image-path>             # insert image
hwpilot image replace <file> <ref> <image-path>      # replace image
```

> Image insert/replace/extract require HWPX format. `image list` works on both.

### create

Create a new blank HWPX document.

```bash
hwpilot create <file> [--font <name>] [--size <pt>] [--pretty]
```

```bash
hwpilot create report.hwpx --font "바탕" --size 12
```

### convert

Convert HWP 5.0 to HWPX.

```bash
hwpilot convert <input> <output> [--force] [--pretty]
```

## Format Support

Format is detected by file content (magic bytes), not by file extension.

| Feature | HWPX | HWP 5.0 |
|---|---|---|
| Read structure / text | ✓ | ✓ |
| Edit text | ✓ | ✓ |
| Edit formatting | ✓ | ✓ |
| Table read / edit / add | ✓ | ✓ |
| Text box read / edit | ✓ | ✓ |
| Find text | ✓ | ✓ |
| Image list | ✓ | ✓ |
| Image insert / replace / extract | ✓ | ✗ |
| Create new document | ✓ | ✓ |

For image operations on HWP 5.0 files, convert first: `hwpilot convert file.hwp file.hwpx`

## Limitations

- **No image ops on HWP 5.0** — convert to HWPX first
- **No encrypted files** — password/DRM protected documents can't be opened
- **No macros, equations, charts, OLE objects**
- **No paragraph-level formatting** — only character formatting (bold, italic, underline, font, size, color)
- **Limited structural edits** — table add is supported, but adding new paragraphs, rows, or sections is not
- **No grouped shapes** — only individual text boxes are supported

## Error Handling

All errors return JSON:

```json
{
  "error": "Paragraph not found for reference: s0.p999",
  "context": { "ref": "s0.p999", "file": "doc.hwp" },
  "hint": "Valid paragraph refs: s0.p0 through s0.p49"
}
```

## Development

```bash
bun install
bun run typecheck
bun run lint
bun test src/
bun run build
```

See [AGENTS.md](./AGENTS.md) for the full development guide.

## Acknowledgments

- [Hancom OWPML spec (KS X 6101)](http://www.hancom.co.kr) — HWPX format specification
- [hwp.js](https://github.com/hahnlee/hwp.js) — open source HWP parser, reference for the HWP 5.0 binary format

## License

MIT
