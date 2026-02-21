# Known Issues — agent-hwp CLI

This document tracks interface inefficiencies discovered during E2E testing.
These are known limitations, not bugs to fix immediately.
See individual test files in `e2e/` for test cases that document these behaviors.

---

## Issue 1: Tables Not Detected in HWP 5.0

**Severity**: High  
**Affected Commands**: `table list`, `read` (sections[N].tables)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The HWP 5.0 reader only extracts tables from true HWP TABLE records (`CTRL_HEADER` with `tbl `, followed by `TABLE` and cell `LIST_HEADER` records).
All 7 current fixtures contain zero `CTRL_HEADER('tbl ')` controls in Section0, so empty table output is expected for this dataset.
These documents appear to encode tabular-looking layouts using other controls (for example form objects or text boxes), not HWP TABLE records.

### Expected Behavior
- `table list` returns tables when TABLE controls exist in the source record stream
- `read` populates `sections[N].tables` only for true TABLE records
- Non-TABLE controls are not exposed as table refs until separate support is implemented

### Actual Behavior
- `table list` returns `[]` for all 7 fixtures because no TABLE controls are present
- `sections[N].tables` stays empty, matching the underlying binary records
- Visually tabular content remains inaccessible through table refs in these fixtures

### Impact on AI Agents
AI agents can only navigate and edit structures backed by actual TABLE records (`sN.tN.rN.cN`).
In these fixtures, there is no table navigation surface even when rendered content appears tabular.

---

## Issue 2: Reader/Writer Paragraph Mismatch

**Severity**: High  
**Affected Commands**: `read`, `edit text`  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The reader reports paragraphs at ALL nesting levels (including those inside control structures), but the writer only handles level-0 paragraphs. This creates a critical mismatch where most reported paragraphs cannot be edited.

### Expected Behavior
- All paragraphs reported by `read` should be editable via `edit text`
- Paragraph references should accurately reflect which paragraphs can be modified

### Actual Behavior
- Reader reports significantly more paragraphs than are actually editable
- Examples of editability rates:
  - 피해자_의견_진술서_양식.hwp: 86 reported, 2 editable (97.7% not editable)
  - 폭행죄(고소장).hwp: 99 reported, 1 editable (99% not editable)
  - 임금 등 청구의 소.hwp: 192 reported, 1 editable (99.5% not editable)
  - 개정 표준근로계약서.hwp: 330 reported, 50 editable (85% not editable)

### Impact on AI Agents
AI agents cannot reliably determine which paragraphs are editable. Attempting to edit non-editable paragraphs will fail, requiring agents to implement trial-and-error logic or maintain their own editability tracking.

---

## Issue 3: Fonts Array Always Empty

**Severity**: Medium  
**Affected Commands**: `read` (header.fonts)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The font list in document headers is not being extracted from HWP 5.0 files, resulting in an empty fonts array.

### Expected Behavior
- `header.fonts` should contain an array of font names used in the document
- Font information should be available for formatting analysis and replication

### Actual Behavior
- `header.fonts` is always `[]` for all HWP 5.0 files
- No font information is available from the document header

### Impact on AI Agents
AI agents cannot determine what fonts are used in a document, limiting their ability to understand or replicate document formatting.

---

## Issue 4: `image list` Fails on HWP with Misleading Error

**Severity**: High  
**Affected Commands**: `image list`  
**Affected Fixtures**: 임금 등 청구의 소.hwp (6 images), 폭행죄(고소장).hwp (3 images)

### Description
The `image list` command fails with an error message stating "HWP 5.0 write not supported", even though this is a READ operation. The error message is misleading and incorrect.

### Expected Behavior
- `image list` should return a list of images in the document
- Images should be readable and their metadata should be accessible
- Error messages should accurately describe the actual problem

### Actual Behavior
- `image list` returns error: "HWP 5.0 write not supported"
- This is a read operation, not a write operation
- Images ARE detectable via the `read` command, but `image list` fails with a misleading error

### Impact on AI Agents
AI agents receive incorrect error messages that suggest the operation is unsupported, when in fact images can be accessed through other commands. This causes confusion and prevents agents from discovering available functionality.

---

## Issue 5: CharShape Data Corruption

**Severity**: Medium  
**Affected Commands**: `read` (header.charShapes)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
Character shape data (fonts, sizes, colors) is corrupted or incorrectly parsed from HWP 5.0 files, resulting in unusable formatting information.

### Expected Behavior
- `fontSize` values should reflect actual point sizes (typically 8-72pt, represented as 8-72)
- Color values should be valid hex codes (e.g., #000000 for black)
- CharShape data should accurately represent document formatting

### Actual Behavior
- `fontSize` values are corrupted (e.g., 65793 instead of ~10-20pt)
- Color values are incorrect (e.g., #640000 instead of #000000)
- CharShape data is unusable for formatting analysis or replication

### Impact on AI Agents
AI agents cannot reliably read or apply character formatting. Corrupted data makes it impossible to understand or replicate document styling.

---

## Issue 6: Image Metadata Corruption in HWP

**Severity**: Medium  
**Affected Commands**: `read` (sections[N].images)  
**Affected Fixtures**: 임금 등 청구의 소.hwp, 폭행죄(고소장).hwp

### Description
Image metadata extracted from HWP 5.0 files contains corrupted or incorrect values for dimensions and binary data paths.

### Expected Behavior
- Image dimensions should be accurate (reasonable pixel values)
- Each image should have a unique `binDataPath` pointing to its binary data
- Image metadata should be usable for image identification and retrieval

### Actual Behavior
- Dimensions are corrupted (e.g., `width: 611346787` — clearly wrong)
- All images share the same `binDataPath` instead of having unique paths
- Image metadata is unusable for distinguishing between images

### Impact on AI Agents
AI agents cannot reliably identify or retrieve images from documents. Corrupted metadata makes it impossible to work with images programmatically.

---

## Issue 7: `convert` Does Not Prevent Overwriting Existing Files

**Severity**: Low  
**Affected Commands**: `convert`  
**Affected Fixtures**: All conversions

### Description
The `convert` command silently overwrites existing output files without warning or confirmation.

### Expected Behavior
- `convert` should either:
  - Refuse to overwrite existing files and return an error, or
  - Prompt the user for confirmation before overwriting, or
  - Provide a `--force` flag to explicitly allow overwriting

### Actual Behavior
- `convert` silently overwrites existing output files without any warning
- No confirmation is requested
- No error is raised

### Impact on AI Agents
Risk of accidental data loss. AI agents may inadvertently overwrite important files without realizing it. This is particularly problematic in automated workflows.

---

## Issue 8: Inconsistent Error Messages

**Severity**: Low  
**Affected Commands**: Various (`edit text` with invalid ref, `image list` on HWP)  
**Affected Fixtures**: All fixtures

### Description
Error messages across the CLI are inconsistent in format and informativeness. Some include the problematic reference, others don't. No suggestions are provided for valid alternatives.

### Expected Behavior
- Error messages should follow a consistent format
- Error messages should include:
  - What went wrong
  - Which reference was invalid (if applicable)
  - What valid references look like
  - Suggestions for recovery
- Example: "Invalid paragraph reference 's0.p999': section 0 has only 50 paragraphs. Valid references: s0.p0 through s0.p49"

### Actual Behavior
- Error messages vary in format and detail
- Some errors include the invalid ref, others don't
- No suggestions for valid alternatives are provided
- `image list` error says "write not supported" for a read operation (see Issue 4)

### Impact on AI Agents
Inconsistent error messages reduce usability for AI agents trying to recover from errors. Agents cannot reliably parse error messages or determine what valid alternatives are available.

---
