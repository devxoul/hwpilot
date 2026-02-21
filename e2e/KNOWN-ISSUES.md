# Known Issues — agent-hwp CLI

This document tracks interface inefficiencies discovered during E2E testing.
These are known limitations, not bugs to fix immediately.
See individual test files in `e2e/` for test cases that document these behaviors.

---

## Issue 1: Tables Not Detected in HWP 5.0

**Status**: ✅ CLARIFIED (39a01b7)  
**Severity**: High  
**Affected Commands**: `table list`, `read` (sections[N].tables)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The HWP 5.0 reader only extracts tables from true HWP TABLE records (`CTRL_HEADER` with `tbl `, followed by `TABLE` and cell `LIST_HEADER` records).
All 7 current fixtures contain zero `CTRL_HEADER('tbl ')` controls in Section0, so empty table output is expected for this dataset.
These documents appear to encode tabular-looking layouts using other controls (for example form objects or text boxes), not HWP TABLE records.

### Resolution
This is a **format limitation, not a code bug**. The fixtures use form controls instead of TABLE records. The code correctly reports empty tables because no TABLE records exist in the source documents. Table detection is working as designed.

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

**Status**: ✅ RESOLVED (1cd7032)  
**Severity**: High  
**Affected Commands**: `read`, `edit text`  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The reader reports paragraphs at ALL nesting levels (including those inside control structures), but the writer only handles level-0 paragraphs. This creates a critical mismatch where most reported paragraphs cannot be edited.

### Resolution
Fixed in commit 1cd7032: Reader now reports only level-0 paragraphs, matching what the writer can actually edit. All reported paragraphs are now editable.

### Expected Behavior
- All paragraphs reported by `read` should be editable via `edit text`
- Paragraph references should accurately reflect which paragraphs can be modified

### Actual Behavior (FIXED)
- Reader now reports only level-0 paragraphs
- All reported paragraphs are editable via `edit text`
- Paragraph references accurately reflect editability

### Impact on AI Agents
AI agents can now reliably determine which paragraphs are editable. All reported paragraphs can be edited without trial-and-error.

---

## Issue 3: Fonts Array Always Empty

**Status**: ✅ RESOLVED (bc04588)  
**Severity**: Medium  
**Affected Commands**: `read` (header.fonts)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
The font list in document headers is not being extracted from HWP 5.0 files, resulting in an empty fonts array.

### Resolution
Fixed in commit bc04588: FACE_NAME record parsing now correctly handles the attribute byte prefix before the font name string. Font lists are now properly extracted.

### Expected Behavior
- `header.fonts` should contain an array of font names used in the document
- Font information should be available for formatting analysis and replication

### Actual Behavior (FIXED)
- `header.fonts` now contains the correct font names from the document
- Font information is available for formatting analysis and replication

### Impact on AI Agents
AI agents can now determine what fonts are used in a document and replicate document formatting accurately.

---

## Issue 4: `image list` Fails on HWP with Misleading Error

**Status**: ✅ RESOLVED (1bda22f)  
**Severity**: High  
**Affected Commands**: `image list`  
**Affected Fixtures**: 임금 등 청구의 소.hwp (6 images), 폭행죄(고소장).hwp (3 images)

### Description
The `image list` command fails with an error message stating "HWP 5.0 write not supported", even though this is a READ operation. The error message is misleading and incorrect.

### Resolution
Fixed in commit 1bda22f: `image list` command now works on HWP files. The command was incorrectly restricted to HWPX format only.

### Expected Behavior
- `image list` should return a list of images in the document
- Images should be readable and their metadata should be accessible
- Error messages should accurately describe the actual problem

### Actual Behavior (FIXED)
- `image list` now returns the list of images in HWP files
- Images are readable and their metadata is accessible
- No misleading error messages

### Impact on AI Agents
AI agents can now reliably list and access images in HWP documents without confusion.

---

## Issue 5: CharShape Data Corruption

**Status**: ✅ RESOLVED (6b8d861)  
**Severity**: Medium  
**Affected Commands**: `read` (header.charShapes)  
**Affected Fixtures**: All 7 HWP 5.0 fixtures

### Description
Character shape data (fonts, sizes, colors) is corrupted or incorrectly parsed from HWP 5.0 files, resulting in unusable formatting information.

### Resolution
Fixed in commit 6b8d861: Corrected CharShape byte offsets and fixed color byte order (BGR → RGB). CharShape data is now parsed correctly.

### Expected Behavior
- `fontSize` values should reflect actual point sizes (typically 8-72pt, represented as 8-72)
- Color values should be valid hex codes (e.g., #000000 for black)
- CharShape data should accurately represent document formatting

### Actual Behavior (FIXED)
- `fontSize` values are now correct
- Color values are now accurate hex codes
- CharShape data accurately represents document formatting

### Impact on AI Agents
AI agents can now reliably read and apply character formatting. Document styling can be understood and replicated accurately.

---

## Issue 6: Image Metadata Corruption in HWP

**Status**: ✅ RESOLVED (b208aa3)  
**Severity**: Medium  
**Affected Commands**: `read` (sections[N].images)  
**Affected Fixtures**: 임금 등 청구의 소.hwp, 폭행죄(고소장).hwp

### Description
Image metadata extracted from HWP 5.0 files contains corrupted or incorrect values for dimensions and binary data paths.

### Resolution
Fixed in commit b208aa3: Corrected SHAPE_COMPONENT and PICTURE record parsing. Image dimensions and binary data paths are now extracted correctly.

### Expected Behavior
- Image dimensions should be accurate (reasonable pixel values)
- Each image should have a unique `binDataPath` pointing to its binary data
- Image metadata should be usable for image identification and retrieval

### Actual Behavior (FIXED)
- Image dimensions are now accurate
- Each image has a unique `binDataPath`
- Image metadata is usable for image identification and retrieval

### Impact on AI Agents
AI agents can now reliably identify and retrieve images from documents. Image metadata is accurate and usable for programmatic image operations.

---

## Issue 7: `convert` Does Not Prevent Overwriting Existing Files

**Status**: ✅ RESOLVED (4119e08)  
**Severity**: Low  
**Affected Commands**: `convert`  
**Affected Fixtures**: All conversions

### Description
The `convert` command silently overwrites existing output files without warning or confirmation.

### Resolution
Fixed in commit 4119e08: `convert` now refuses to overwrite existing files unless `--force` flag is provided.

### Expected Behavior
- `convert` should either:
  - Refuse to overwrite existing files and return an error, or
  - Prompt the user for confirmation before overwriting, or
  - Provide a `--force` flag to explicitly allow overwriting

### Actual Behavior (FIXED)
- `convert` now refuses to overwrite existing output files
- A `--force` flag is available to explicitly allow overwriting
- Clear error message is provided when attempting to overwrite

### Impact on AI Agents
AI agents are now protected from accidental data loss. The `--force` flag provides explicit control over overwriting behavior in automated workflows.

---

## Issue 8: Inconsistent Error Messages

**Status**: ✅ RESOLVED (261f28a)  
**Severity**: Low  
**Affected Commands**: Various (`edit text` with invalid ref, `image list` on HWP)  
**Affected Fixtures**: All fixtures

### Description
Error messages across the CLI are inconsistent in format and informativeness. Some include the problematic reference, others don't. No suggestions are provided for valid alternatives.

### Resolution
Fixed in commit 261f28a: Error messages are now standardized with context and helpful hints. All errors include what went wrong, the invalid reference (if applicable), and suggestions for recovery.

### Expected Behavior
- Error messages should follow a consistent format
- Error messages should include:
  - What went wrong
  - Which reference was invalid (if applicable)
  - What valid references look like
  - Suggestions for recovery
- Example: "Invalid paragraph reference 's0.p999': section 0 has only 50 paragraphs. Valid references: s0.p0 through s0.p49"

### Actual Behavior (FIXED)
- Error messages now follow a consistent format
- All errors include context and the invalid reference
- Suggestions for valid alternatives are provided
- Error messages are helpful for recovery

### Impact on AI Agents
AI agents can now reliably parse error messages and determine what valid alternatives are available. Error recovery is straightforward and consistent.

---
