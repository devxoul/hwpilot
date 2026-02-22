---
name: hwp
description: "Read and edit HWP/HWPX Korean document files in-place. Use when user asks to read, edit, create, or convert Korean word processor documents (.hwp, .hwpx). Triggers: 'hwp', 'hwpx', 'Korean document', 'hangul document', '한글 문서', '한글 파일', 'HWP 파일', '문서 편집', '문서 읽기'."
allowed-tools: Bash(hwp:*)
---

# HWP CLI

Native HWP/HWPX document editor for AI agents. Read, edit, and create Korean word processor documents without format conversion. All commands output JSON.

## Quick Start

```bash
# Read document structure
hwp read document.hwpx

# Extract text from a specific paragraph
hwp text document.hwpx s0.p0

# Edit text in-place
hwp edit text document.hwpx s0.p0 "Updated content"

# Read a table
hwp table read document.hwpx s0.t0

# Convert legacy HWP to editable HWPX
hwp convert legacy.hwp output.hwpx
```

## Reference System

Documents use hierarchical refs to address elements. All indices are 0-based.

| Ref Pattern | Target | Example |
|---|---|---|
| `s{N}` | Section N | `s0` |
| `s{N}.p{M}` | Paragraph M in section N | `s0.p0` |
| `s{N}.p{M}.r{K}` | Run K in paragraph M | `s0.p2.r1` |
| `s{N}.t{M}` | Table M in section N | `s0.t0` |
| `s{N}.t{M}.r{R}.c{C}` | Row R, cell C of table M | `s0.t1.r2.c0` |
| `s{N}.t{M}.r{R}.c{C}.p{P}` | Paragraph P inside table cell | `s0.t0.r0.c0.p0` |
| `s{N}.tb{M}` | Text box M in section N | `s0.tb0` |
| `s{N}.tb{M}.p{P}` | Paragraph P inside text box M | `s0.tb0.p0` |
| `s{N}.img{M}` | Image M in section N | `s0.img0` |

A "run" is a contiguous span of text sharing the same character formatting within a paragraph. Most paragraphs have a single run (`r0`).

### Ref Examples

- `s0` ... first section (all paragraphs, tables, images)
- `s0.p0` ... first paragraph of first section
- `s0.t0.r1.c2` ... table 0, row 1, cell 2
- `s0.t0.r0.c0.p0` ... first paragraph inside a table cell
- `s0.tb0` ... first text box in section 0
- `s0.tb0.p0` ... first paragraph inside text box 0
- `s0.img0` ... first image in section 0

## Command Reference

### `hwp read` ... Read document structure

```bash
hwp read <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

Without a ref, returns the full document tree. With a ref, returns that specific element. Use `--offset` and `--limit` to paginate paragraphs and reduce output size.

| Option | Effect |
|---|---|
| `--offset <n>` | Skip first N paragraphs (0-indexed) |
| `--limit <n>` | Return at most N paragraphs |

```bash
# First 20 paragraphs
hwp read report.hwpx --limit 20

# Paragraphs 20–39
hwp read report.hwpx --offset 20 --limit 20

# Single paragraph by ref (no pagination needed)
hwp read report.hwpx s0.p0

# A table
hwp read report.hwpx s0.t0
```

Example output (with pagination):

```json
{
  "format": "hwpx",
  "sections": [{
    "index": 0,
    "totalParagraphs": 50,
    "totalTables": 2,
    "totalImages": 1,
    "paragraphs": [
      { "ref": "s0.p0", "runs": [{ "text": "Title", "charShapeRef": 0 }] },
      { "ref": "s0.p1", "runs": [{ "text": "Body text here", "charShapeRef": 1 }] }
    ],
    "tables": [...],
    "images": [...]
  }],
  "header": { ... }
}
```

When `--offset` or `--limit` is used, each section includes `totalParagraphs`, `totalTables`, and `totalImages` counts. Without pagination flags, these fields are omitted (backward compatible).

### `hwp text` ... Extract text

```bash
hwp text <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

Without a ref, returns all text concatenated. With a ref, returns text from that element only. Use `--offset` and `--limit` to paginate paragraphs.

```bash
# All text in document
hwp text report.hwpx

# First 10 paragraphs of text
hwp text report.hwpx --limit 10

# Paragraphs 10–19
hwp text report.hwpx --offset 10 --limit 10

# Text from one paragraph
hwp text report.hwpx s0.p0

# Text from a table cell
hwp text report.hwpx s0.t0.r0.c0
```

Example output:

```json
{ "ref": "s0.p0", "text": "Title" }
```

```json
{ "text": "Title\nBody text here\nMore content" }
```

Example output (with pagination):

```json
{ "text": "Para10\nPara11\nPara12", "totalParagraphs": 50, "offset": 10, "count": 3 }
```

### `hwp find` ... Search text in document

```bash
hwp find <file> <query> [--json]
```

Searches all text containers (paragraphs, table cells, text boxes) for a case-insensitive substring match. Returns matching refs with their text. Handles text split across runs.

```bash
# Find text in any container
hwp find document.hwpx "청구취지"

# JSON output with container type
hwp find document.hwpx "청구취지" --json
```

Default output (one match per line):

```
s0.p3: 청구취지
s0.tb0.p0: 청구취지 및 청구원인
```

JSON output:

```json
{"matches":[{"ref":"s0.p3","text":"청구취지","container":"paragraph"},{"ref":"s0.tb0.p0","text":"청구취지 및 청구원인","container":"textBox"}]}
```

No matches returns empty output (exit code 0).

### `hwp edit text` ... Edit text in-place

```bash
hwp edit text <file> <ref> <text> [--pretty]
```

Replaces the text at the given ref. The file is modified in-place.

```bash
hwp edit text report.hwpx s0.p0 "New Title"
hwp edit text report.hwpx s0.t0.r0.c0 "Cell value"
hwp edit text report.hwpx s0.tb0.p0 "Text box content"
```

Example output:

```json
{ "ref": "s0.p0", "text": "New Title", "success": true }
```

### `hwp edit format` ... Edit character formatting

```bash
hwp edit format <file> <ref> [options] [--pretty]
```

Options:

| Flag | Effect |
|---|---|
| `--bold` | Apply bold |
| `--no-bold` | Remove bold |
| `--italic` | Apply italic |
| `--no-italic` | Remove italic |
| `--underline` | Apply underline |
| `--no-underline` | Remove underline |
| `--font <name>` | Set font name |
| `--size <pt>` | Set font size in points |
| `--color <hex>` | Set text color (e.g. `#FF0000`) |

```bash
hwp edit format report.hwpx s0.p0 --bold --size 16 --font "맑은 고딕"
hwp edit format report.hwpx s0.p1 --italic --color "#0000FF"
```

### `hwp table read` ... Read table structure

```bash
hwp table read <file> <ref> [--pretty]
```

Returns the full table structure including all rows, cells, and their text content.

```bash
hwp table read report.hwpx s0.t0
```

### `hwp table edit` ... Edit table cell text

```bash
hwp table edit <file> <ref> <text> [--pretty]
```

The ref must point to a table cell (e.g. `s0.t0.r0.c0`).

```bash
hwp table edit report.hwpx s0.t0.r0.c0 "Updated cell"
hwp table edit report.hwpx s0.t0.r1.c2 "3,500"
```

### `hwp image list` ... List all images

```bash
hwp image list <file> [--pretty]
```

Returns all images in the document with their refs and metadata. Works on both HWP 5.0 and HWPX files.

```bash
hwp image list report.hwpx
```

### `hwp image extract` ... Extract an image to file

```bash
hwp image extract <file> <ref> <output-path> [--pretty]
```

```bash
hwp image extract report.hwpx s0.img0 ./logo.png
```

### `hwp image insert` ... Insert an image

```bash
hwp image insert <file> <image-path> [--pretty]
```

```bash
hwp image insert report.hwpx ./photo.jpg
```

### `hwp image replace` ... Replace an existing image

```bash
hwp image replace <file> <ref> <image-path> [--pretty]
```

```bash
hwp image replace report.hwpx s0.img0 ./new-logo.png
```

### `hwp create` ... Create a new document

```bash
hwp create <file> [--title <text>] [--font <name>] [--size <pt>] [--pretty]
```

Creates a new blank HWPX document. Defaults: font "맑은 고딕", size 10pt.

```bash
hwp create new-doc.hwpx
hwp create report.hwpx --title "Monthly Report" --font "바탕" --size 12
```

### `hwp convert` ... Convert HWP to HWPX

```bash
hwp convert <input.hwp> <output.hwpx> [--force] [--pretty]
```

Converts a legacy HWP 5.0 file to the editable HWPX format.

Refuses to overwrite an existing output file unless `--force` is specified.

```bash
hwp convert old-doc.hwp new-doc.hwpx
```

## Common Patterns

### 1. Read a document and understand its structure

**Always start with `--limit` to paginate.** Korean government documents often have 50+ paragraphs — dumping everything wastes context. Page through progressively.

```bash
# Get first 20 paragraphs + total counts (recommended first step)
hwp read document.hwpx --limit 20

# Continue reading from paragraph 20
hwp read document.hwpx --offset 20 --limit 20

# Drill into specific elements
hwp read document.hwpx s0.p0
hwp read document.hwpx s0.t0
hwp read document.hwpx s0.tb0
```

### 2. Find and edit text

Use `hwp find` to locate content by ref, then `hwp edit text` to change it. This is much faster than reading paragraphs one by one.

```bash
# Search for text across all containers (paragraphs, tables, text boxes)
hwp find document.hwpx "청구취지"
# Output: s0.tb0.p0: 청구취지 및 청구원인

# Edit the matched ref directly
hwp edit text document.hwpx s0.tb0.p0 "Updated content"
```

### 3. Fill in a template (table cells)

Read the table structure first, then edit each cell.

```bash
# See the table layout
hwp table read document.hwpx s0.t0

# Fill in cells one by one
hwp table edit document.hwpx s0.t0.r0.c0 "Name"
hwp table edit document.hwpx s0.t0.r0.c1 "Date"
hwp table edit document.hwpx s0.t0.r1.c0 "Kim Minjun"
hwp table edit document.hwpx s0.t0.r1.c1 "2025-01-15"
```

### 4. Fill in a form template (text boxes)

Korean government templates often use text boxes instead of tables for form fields. Use `find` to locate them, then edit.

```bash
# Find all form fields
hwp find template.hwpx "" --json
# Shows all non-empty text across paragraphs, tables, and text boxes

# Read the text box structure
hwp read template.hwpx s0.tb0

# Fill in text box fields
hwp edit text template.hwpx s0.tb0.p0 "홍길동"
hwp edit text template.hwpx s0.tb1.p0 "2025-01-15"
```

### 5. Extract all text for analysis

Pull the full document text without specifying a ref. Use `--limit` for large documents.

```bash
# First 30 paragraphs
hwp text document.hwpx --limit 30

# All text (can be large)
hwp text document.hwpx
# Returns: { "text": "all document text concatenated with newlines" }
```

### 6. Edit HWP 5.0 binary files directly

HWP 5.0 files support text, table cell, and character formatting edits in-place.

```bash
hwp edit text document.hwp s0.p0 "Updated title"
hwp edit format document.hwp s0.p0 --bold --size 18
hwp table edit document.hwp s0.t0.r0.c0 "New cell value"
```

To convert HWP to HWPX (e.g. for image operations):

```bash
hwp convert legacy.hwp editable.hwpx
```

### 7. Create a new document with content

Create a blank document, then populate it.

```bash
hwp create report.hwpx --title "Quarterly Report" --font "맑은 고딕" --size 11
hwp edit text report.hwpx s0.p0 "Q4 2025 Quarterly Report"
hwp edit format report.hwpx s0.p0 --bold --size 18
```

## Format Support

**Important**: Format is detected by file content (magic bytes), NOT by file extension. A `.hwp` file may contain HWPX format inside. Both HWP 5.0 and HWPX support text, table, and formatting edits.

| Feature | HWPX (ZIP magic `50 4B 03 04`) | HWP 5.0 (CFB magic `D0 CF 11 E0`) |
|---|---|---|
| Read structure | Yes | Yes |
| Read text | Yes | Yes |
| Edit text | Yes | Yes |
| Edit formatting | Yes | Yes (bold, italic, underline, fontSize, color) |
| Table read | Yes | Yes |
| Table edit | Yes | Yes |
| Text box read | Yes | Yes |
| Text box edit | Yes | Yes |
| Find text | Yes | Yes |
| Image list | Yes | Yes |
| Image insert/replace/extract | Yes | No (convert to HWPX first) |
| Create new | Yes | No |

**HWPX** (ZIP+XML) is the modern format with full read/write support including images.

**HWP 5.0** (binary CFB) supports read and write for text, table cells, and character formatting. Image operations and creating new files require HWPX — use `hwp convert` to convert.

## Limitations

What's NOT supported:

- **HWP 5.0 images**: Image insert, replace, and extract require HWPX format. `image list` works on both formats. Convert with `hwp convert`.
- **Password/DRM protected files**: Cannot open encrypted documents.
- **Macros and scripts**: No macro execution or editing.
- **Equations, charts, OLE objects, video**: These embedded objects can't be read or modified.
- **Grouped/container shapes**: Only individual text boxes are supported — grouped shapes (`SHAPE_COMPONENT_CONTAINER`) are ignored.
- **Text box formatting**: Text inside text boxes can be edited, but character formatting (`edit format`) on text box refs is not supported.
- **Paragraph-level formatting**: Alignment, spacing, indentation aren't editable. Only character formatting (bold, italic, underline, font, size, color) is supported.
- **Adding new paragraphs or sections**: You can only edit existing content. Can't insert new paragraphs, rows, or sections into an existing document.

## Error Handling

All errors return JSON with an `error` field:

```json
{ "error": "Paragraph not found for reference: s0.p999", "context": { "ref": "s0.p999", "file": "doc.hwp" }, "hint": "Valid paragraph refs: s0.p0 through s0.p49" }
```

Error responses include optional `context` (ref, file) and `hint` (valid alternatives) fields.

Common errors and fixes:

| Error | Cause | Fix |
|---|---|---|
| `Unsupported file format` | File content is not HWP or HWPX | Ensure file has valid HWP/HWPX content (checked by magic bytes, not extension) |
| `Invalid reference: s0.x1` | Malformed ref | Check ref format (see Reference System above) |
| `Section N not found` | Ref points beyond document | Use `hwp read` to check available sections |
| `Paragraph N not found` | Ref points beyond section | Use `hwp read <file> s0` to see paragraph count |
| `Table N not found` | No such table | Use `hwp read` to list tables |
| `TextBox N not found` | No such text box | Use `hwp read` to list text boxes, or `hwp find` to search |
| `Image insert/replace/extract requires HWPX format` | Write image ops on HWP 5.0 file | Convert first: `hwp convert file.hwp file.hwpx` |
| `File already exists: <path>` | Convert output file already exists | Use `--force` flag or choose a different output path |
| `ENOENT: no such file` | File doesn't exist | Check file path |
