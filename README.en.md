# hwpcli

[![한국어](https://img.shields.io/badge/lang-한국어-blue)](./README.md)

Native CLI for reading and writing HWP/HWPX documents. Built for AI agents that need to work with Korean word processor files programmatically.

All commands output JSON. All edits happen in-place.

## Install

```bash
npm install -g hwpcli
```

## Usage

```bash
# Read first 20 paragraphs
hwp read document.hwpx --limit 20

# Search for text
hwp find document.hwpx "청구취지"

# Edit a paragraph
hwp edit text document.hwpx s0.p0 "New content"

# Edit a table cell
hwp table edit document.hwpx s0.t0.r0.c0 "Cell value"

# Bold + resize
hwp edit format document.hwpx s0.p0 --bold --size 16

# Convert HWP 5.0 → HWPX
hwp convert legacy.hwp output.hwpx
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
hwp read <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwp read report.hwpx --limit 20          # first 20 paragraphs
hwp read report.hwpx --offset 20 --limit 20  # next 20
hwp read report.hwpx s0.t0               # a specific table
```

### text

Extract plain text.

```bash
hwp text <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwp text report.hwpx                     # all text
hwp text report.hwpx s0.p0               # one paragraph
hwp text report.hwpx s0.t0.r0.c0         # a table cell
```

### find

Search text across all containers (paragraphs, tables, text boxes). Case-insensitive.

```bash
hwp find <file> <query> [--json]
```

```bash
hwp find document.hwpx "청구취지"
# s0.p3: 청구취지
# s0.tb0.p0: 청구취지 및 청구원인

hwp find document.hwpx "청구취지" --json
# {"matches":[{"ref":"s0.p3","text":"청구취지","container":"paragraph"},...]}
```

### edit text

Replace text at a ref. Modifies the file in-place.

```bash
hwp edit text <file> <ref> <text> [--pretty]
```

```bash
hwp edit text report.hwpx s0.p0 "New Title"
hwp edit text report.hwpx s0.t0.r0.c0 "Cell value"
hwp edit text report.hwpx s0.tb0.p0 "Text box content"
```

### edit format

Change character formatting at a ref.

```bash
hwp edit format <file> <ref> [options] [--pretty]
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
hwp edit format report.hwpx s0.p0 --bold --size 16 --font "맑은 고딕"
hwp edit format report.hwpx s0.p1 --italic --color "#0000FF"
```

### table read

Read a table's structure (rows, cells, text).

```bash
hwp table read <file> <ref> [--pretty]
```

### table edit

Edit text in a table cell.

```bash
hwp table edit <file> <ref> <text> [--pretty]
```

```bash
hwp table edit report.hwpx s0.t0.r0.c0 "Name"
hwp table edit report.hwpx s0.t0.r0.c1 "Date"
```

### table list

List all tables in the document.

```bash
hwp table list <file> [--pretty]
```

### image list / extract / insert / replace

```bash
hwp image list <file>                            # list all images
hwp image extract <file> <ref> <output-path>     # extract to file
hwp image insert <file> <image-path>             # insert image
hwp image replace <file> <ref> <image-path>      # replace image
```

> Image insert/replace/extract require HWPX format. `image list` works on both.

### create

Create a new blank HWPX document.

```bash
hwp create <file> [--title <text>] [--font <name>] [--size <pt>] [--pretty]
```

```bash
hwp create report.hwpx --title "Monthly Report" --font "바탕" --size 12
```

### convert

Convert HWP 5.0 to HWPX.

```bash
hwp convert <input> <output> [--force] [--pretty]
```

## Format Support

Format is detected by file content (magic bytes), not by file extension.

| Feature | HWPX | HWP 5.0 |
|---|---|---|
| Read structure / text | ✓ | ✓ |
| Edit text | ✓ | ✓ |
| Edit formatting | ✓ | ✓ |
| Table read / edit | ✓ | ✓ |
| Text box read / edit | ✓ | ✓ |
| Find text | ✓ | ✓ |
| Image list | ✓ | ✓ |
| Image insert / replace / extract | ✓ | ✗ |
| Create new document | ✓ | ✗ |

For image operations on HWP 5.0 files, convert first: `hwp convert file.hwp file.hwpx`

## Limitations

- **No image ops on HWP 5.0** — convert to HWPX first
- **No encrypted files** — password/DRM protected documents can't be opened
- **No macros, equations, charts, OLE objects**
- **No paragraph-level formatting** — only character formatting (bold, italic, underline, font, size, color)
- **No structural edits** — can't add new paragraphs, rows, or sections; only edit existing content
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
