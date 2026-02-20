# HWP - Claude Code Plugin

Native HWP/HWPX document editor CLI for AI agents. Read and write Korean word processor documents programmatically.

## Installation

```bash
# Add the marketplace
claude plugin marketplace add devxoul/agent-hwp

# Install the plugin
claude plugin install hwp
```

Or within Claude Code:

```
/plugin marketplace add devxoul/agent-hwp
/plugin install hwp
```

## What it does

Enables AI agents to interact with HWP/HWPX documents through a CLI interface:

- **Read documents** — Extract full document structure, paragraphs, tables, and metadata
- **Edit text** — Modify paragraph and table cell content in-place
- **Format text** — Apply bold, italic, underline, font, and size formatting
- **Manage tables** — Read and edit table structures with cell references
- **Handle images** — Extract, insert, and replace images in documents
- **Convert formats** — Convert HWP 5.0 (binary) to HWPX (modern ZIP+XML)
- **Reference system** — Navigate documents using hierarchical references (s0.p0, s0.t1.r2.c0)

## Key Features

### Full HWPX Support (Read/Write)
Modern HWPX format (ZIP+XML) with complete read and write capabilities. Preserves formatting, styles, and document structure.

### HWP 5.0 Read-Only
Read legacy HWP 5.0 binary format documents. Convert to HWPX for editing.

### Hierarchical References
Navigate documents using dot-notation references:
- `s0` — Section 0
- `s0.p3` — Paragraph 3 in section 0
- `s0.t1.r2.c0` — Cell at row 2, column 0 in table 1
- `s0.img0` — First image in section 0

### JSON Output
All commands output JSON by default for easy AI consumption. Use `--pretty` for human-readable output.

## Requirements

- Node.js 18+ or Bun runtime

## Quick Start

```bash
# Read a document
hwp read document.hwpx

# Extract text
hwp text document.hwpx

# Edit paragraph text
hwp edit text document.hwpx s0.p0 "New paragraph content"

# Read a table
hwp table read document.hwpx s0.t0

# Create a new document
hwp create new-document.hwpx

# Convert HWP to HWPX
hwp convert document.hwp --to hwpx --output document.hwpx
```

## More Information

- [GitHub Repository](https://github.com/devxoul/agent-hwp)
- [HWP Skill Documentation](https://github.com/devxoul/agent-hwp/blob/main/skills/hwp/SKILL.md)
