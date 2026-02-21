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
| `s{N}.img{M}` | Image M in section N | `s0.img0` |

A "run" is a contiguous span of text sharing the same character formatting within a paragraph. Most paragraphs have a single run (`r0`).

### Ref Examples

- `s0` ... first section (all paragraphs, tables, images)
- `s0.p0` ... first paragraph of first section
- `s0.t0.r1.c2` ... table 0, row 1, cell 2
- `s0.t0.r0.c0.p0` ... first paragraph inside a table cell
- `s0.img0` ... first image in section 0

## Command Reference

### `hwp read` ... Read document structure

```bash
hwp read <file> [ref] [--pretty]
```

Without a ref, returns the full document tree. With a ref, returns that specific element.

```bash
# Full document
hwp read report.hwpx

# Single paragraph
hwp read report.hwpx s0.p0

# A table
hwp read report.hwpx s0.t0
```

Example output (full document):

```json
{
  "format": "hwpx",
  "sections": [{
    "index": 0,
    "paragraphs": [
      { "ref": "s0.p0", "runs": [{ "text": "Title", "charShapeRef": 0 }] },
      { "ref": "s0.p1", "runs": [{ "text": "Body text here", "charShapeRef": 1 }] }
    ],
    "tables": [],
    "images": []
  }],
  "header": { ... }
}
```

### `hwp text` ... Extract text

```bash
hwp text <file> [ref] [--pretty]
```

Without a ref, returns all text concatenated. With a ref, returns text from that element only.

```bash
# All text in document
hwp text report.hwpx

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

### `hwp edit text` ... Edit text in-place

```bash
hwp edit text <file> <ref> <text> [--pretty]
```

Replaces the text at the given ref. The file is modified in-place.

```bash
hwp edit text report.hwpx s0.p0 "New Title"
hwp edit text report.hwpx s0.t0.r0.c0 "Cell value"
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

Returns all images in the document with their refs and metadata.

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
hwp convert <input.hwp> <output.hwpx> [--pretty]
```

Converts a legacy HWP 5.0 file to the editable HWPX format.

```bash
hwp convert old-doc.hwp new-doc.hwpx
```

## Common Patterns

### 1. Read a document and understand its structure

Start with `hwp read` to see sections, paragraphs, tables, and images. Then drill into specific elements.

```bash
hwp read document.hwpx --pretty
# Inspect the output: count paragraphs, find tables, locate images
hwp read document.hwpx s0.p0
hwp read document.hwpx s0.t0
```

### 2. Find and replace text

Use `hwp text` to find content, then `hwp edit text` to replace it.

```bash
# Extract all text to find what you're looking for
hwp text document.hwpx

# Read specific paragraphs to locate the target
hwp text document.hwpx s0.p0
hwp text document.hwpx s0.p1
hwp text document.hwpx s0.p2

# Replace the text you found
hwp edit text document.hwpx s0.p2 "Corrected text"
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

### 4. Extract all text for analysis

Pull the full document text without specifying a ref.

```bash
hwp text document.hwpx
# Returns: { "text": "all document text concatenated with newlines" }
```

### 5. Edit HWP 5.0 binary files directly

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

### 6. Create a new document with content

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
| Image operations | Yes | No |
| Create new | Yes | No |

**HWPX** (ZIP+XML) is the modern format with full read/write support including images.

**HWP 5.0** (binary CFB) supports read and write for text, table cells, and character formatting. Image operations and creating new files require HWPX — use `hwp convert` to convert.

## Limitations

What's NOT supported:

- **HWP 5.0 images**: Image operations (list, extract, insert, replace) are not supported for HWP 5.0 binary files. Convert to HWPX first.
- **Password/DRM protected files**: Cannot open encrypted documents.
- **Macros and scripts**: No macro execution or editing.
- **Equations, charts, OLE objects, video**: These embedded objects can't be read or modified.
- **Paragraph-level formatting**: Alignment, spacing, indentation aren't editable. Only character formatting (bold, italic, underline, font, size, color) is supported.
- **Adding new paragraphs or sections**: You can only edit existing content. Can't insert new paragraphs, rows, or sections into an existing document.

## Error Handling

All errors return JSON with an `error` field:

```json
{ "error": "Section 5 not found" }
```

Common errors and fixes:

| Error | Cause | Fix |
|---|---|---|
| `Unsupported file format` | File content is not HWP or HWPX | Ensure file has valid HWP/HWPX content (checked by magic bytes, not extension) |
| `Invalid reference: s0.x1` | Malformed ref | Check ref format (see Reference System above) |
| `Section N not found` | Ref points beyond document | Use `hwp read` to check available sections |
| `Paragraph N not found` | Ref points beyond section | Use `hwp read <file> s0` to see paragraph count |
| `Table N not found` | No such table | Use `hwp read` to list tables |
| `HWP 5.0 image not supported` | Image ops on HWP 5.0 file | Convert to HWPX first: `hwp convert file.hwp file.hwpx` |
| `ENOENT: no such file` | File doesn't exist | Check file path |
