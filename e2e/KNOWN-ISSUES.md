# E2E Known Issues

This file tracks interface limitations and known issues discovered during E2E testing against real HWP fixtures.

---

## HWP Viewer reports corruption on s0.p0 text edits (certain fixtures)

**Discovered**: 2026-02-24
**Detection method**: HWP Viewer corruption check (`checkViewerCorruption` in `e2e/helpers.ts`)

### Symptom
When `hwpcli edit text <file> s0.p0 <new-text>` is applied to these fixtures, the official Hancom HWP Viewer shows:
> 파일이 손상되었습니다. (The file is corrupted.)

Affected fixtures:
 `폭행죄(고소장).hwp` (assaultComplaint)
 `개정 표준근로계약서(2025년, 배포).hwp` (employmentContract)
 `개정 표준취업규칙(2025년, 배포).hwp` (employmentRules)
 `표준 근로계약서(7종)(19.6월).hwp` (standardContracts)
 `근로소득원천징수영수증(개정안 2021.11.29.).hwp` (withholdingTax)
 `임금 등 청구의 소.hwp` (wageClaim)

**Not** affected:
 `피해자_의견_진술서_양식.hwp` — s0.p1 edit passes
 `개정 표준근로계약서(2025년, 배포).hwp` — table cell edit (s0.t6.r0.c1) passes
 All unmodified (original) fixture files open without corruption alert

### What passes
 Opening unmodified HWP files → no corruption alert
 Editing paragraphs that are **not** s0.p0 in some fixtures (s0.p1 in victimStatement)
 Table cell edits (`table edit` command)

### Root cause
Unknown. HWP binary format integrity checks in the viewer appear stricter than what `hwpcli`'s binary writer produces for certain paragraph configurations. The `crossValidate` round-trip (HWP→HWPX conversion + XML check) passes for all these fixtures, meaning the content is written correctly, but the binary-level structure may violate an HWP 5.0 format constraint that the official viewer enforces.

Candidates:
 Incorrect record size/offset after paragraph rewrite
 Missing or incorrect trailing record padding
 ParaShape or CharShape index mismatch after edit

### Impact on test suite
The `Z. Viewer Corruption Check` describe blocks in these test files fail when the HWP Viewer is installed locally:
 `e2e/assault-complaint.test.ts`
 `e2e/employment-contract.test.ts`
 `e2e/employment-rules.test.ts`
 `e2e/standard-contracts.test.ts`
 `e2e/withholding-tax.test.ts`
 `e2e/wage-claim.test.ts`
 `e2e/para-header-nchars.test.ts`

These failures are **intentional**. The viewer check works correctly as a canary detecting real format issues. Tests pass when HWP Viewer is not installed (checks skip automatically via `describe.skipIf`).

### Resolution
Fix the HWP binary writer to produce format-compliant output for paragraph text edits on all fixture types.