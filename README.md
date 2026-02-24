# hwpilot

[![English](https://img.shields.io/badge/lang-English-blue)](./README.en.md)

HWP/HWPX 문서를 읽고 쓰는 네이티브 CLI. AI 에이전트가 한글 문서를 프로그래밍 방식으로 다룰 수 있도록 설계되었습니다.

모든 명령어는 JSON을 출력합니다. 모든 편집은 파일을 직접 수정합니다.

## 설치

```bash
npm install -g hwpilot
```

## 사용법

```bash
# 처음 20개 문단 읽기
hwpilot read document.hwpx --limit 20

# 텍스트 검색
hwpilot find document.hwpx "청구취지"

# 문단 편집
hwpilot edit text document.hwpx s0.p0 "새로운 내용"

# 표 셀 편집
hwpilot table edit document.hwpx s0.t0.r0.c0 "셀 값"

# 굵게 + 크기 변경
hwpilot edit format document.hwpx s0.p0 --bold --size 16

# HWP 5.0 → HWPX 변환
hwpilot convert legacy.hwp output.hwpx
```

## 참조 체계

문서의 모든 요소는 계층적 참조(ref)로 지정합니다. 인덱스는 0부터 시작합니다.

```
s{N}                    → 섹션
s{N}.p{M}               → 문단
s{N}.p{M}.r{K}          → 런 (동일한 서식을 가진 텍스트 구간)
s{N}.t{M}               → 표
s{N}.t{M}.r{R}.c{C}     → 표 셀
s{N}.t{M}.r{R}.c{C}.p{P} → 표 셀 안의 문단
s{N}.tb{M}              → 텍스트 박스
s{N}.tb{M}.p{P}         → 텍스트 박스 안의 문단
s{N}.img{M}             → 이미지
```

예시:
- `s0.p0` — 첫 번째 문단
- `s0.t0.r1.c2` — 표 0, 행 1, 셀 2
- `s0.tb0.p0` — 첫 번째 텍스트 박스 안의 첫 번째 문단

## 명령어

### read

문서 구조를 읽습니다. `--offset`과 `--limit`으로 페이지네이션할 수 있습니다.

```bash
hwpilot read <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwpilot read report.hwpx --limit 20          # 처음 20개 문단
hwpilot read report.hwpx --offset 20 --limit 20  # 다음 20개
hwpilot read report.hwpx s0.t0               # 특정 표
```

### text

텍스트를 추출합니다.

```bash
hwpilot text <file> [ref] [--offset <n>] [--limit <n>] [--pretty]
```

```bash
hwpilot text report.hwpx                     # 전체 텍스트
hwpilot text report.hwpx s0.p0               # 문단 하나
hwpilot text report.hwpx s0.t0.r0.c0         # 표 셀
```

### find

모든 컨테이너(문단, 표, 텍스트 박스)에서 텍스트를 검색합니다. 대소문자를 구분하지 않습니다.

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

참조 위치의 텍스트를 교체합니다. 파일을 직접 수정합니다.

```bash
hwpilot edit text <file> <ref> <text> [--pretty]
```

```bash
hwpilot edit text report.hwpx s0.p0 "새 제목"
hwpilot edit text report.hwpx s0.t0.r0.c0 "셀 값"
hwpilot edit text report.hwpx s0.tb0.p0 "텍스트 박스 내용"
```

### edit format

참조 위치의 글자 서식을 변경합니다.

```bash
hwpilot edit format <file> <ref> [options] [--pretty]
```

| 플래그 | 효과 |
|---|---|
| `--bold` / `--no-bold` | 굵게 토글 |
| `--italic` / `--no-italic` | 기울임 토글 |
| `--underline` / `--no-underline` | 밑줄 토글 |
| `--font <name>` | 글꼴 설정 |
| `--size <pt>` | 글자 크기 설정 |
| `--color <hex>` | 글자 색상 설정 (예: `#FF0000`) |

```bash
hwpilot edit format report.hwpx s0.p0 --bold --size 16 --font "맑은 고딕"
hwpilot edit format report.hwpx s0.p1 --italic --color "#0000FF"
```

### table read

표 구조(행, 셀, 텍스트)를 읽습니다.

```bash
hwpilot table read <file> <ref> [--pretty]
```

### table edit

표 셀의 텍스트를 편집합니다.

```bash
hwpilot table edit <file> <ref> <text> [--pretty]
```

```bash
hwpilot table edit report.hwpx s0.t0.r0.c0 "이름"
hwpilot table edit report.hwpx s0.t0.r0.c1 "날짜"
```

### table list

문서의 모든 표를 나열합니다.

```bash
hwpilot table list <file> [--pretty]
```

### image list / extract / insert / replace

```bash
hwpilot image list <file>                            # 모든 이미지 나열
hwpilot image extract <file> <ref> <output-path>     # 이미지 추출
hwpilot image insert <file> <image-path>             # 이미지 삽입
hwpilot image replace <file> <ref> <image-path>      # 이미지 교체
```

> 이미지 삽입/교체/추출은 HWPX 포맷에서만 가능합니다. `image list`는 두 포맷 모두 지원합니다.

### create

빈 HWPX 문서를 생성합니다.

```bash
hwpilot create <file> [--title <text>] [--font <name>] [--size <pt>] [--pretty]
```

```bash
hwpilot create report.hwpx --title "월간 보고서" --font "바탕" --size 12
```

### convert

HWP 5.0을 HWPX로 변환합니다.

```bash
hwpilot convert <input> <output> [--force] [--pretty]
```

## 포맷 지원

포맷은 파일 확장자가 아닌 파일 내용(매직 바이트)으로 판별합니다.

| 기능 | HWPX | HWP 5.0 |
|---|---|---|
| 구조/텍스트 읽기 | ✓ | ✓ |
| 텍스트 편집 | ✓ | ✓ |
| 서식 편집 | ✓ | ✓ |
| 표 읽기/편집 | ✓ | ✓ |
| 텍스트 박스 읽기/편집 | ✓ | ✓ |
| 텍스트 검색 | ✓ | ✓ |
| 이미지 목록 | ✓ | ✓ |
| 이미지 삽입/교체/추출 | ✓ | ✗ |
| 새 문서 생성 | ✓ | ✗ |

HWP 5.0 파일에서 이미지 작업이 필요하면 먼저 변환하세요: `hwpilot convert file.hwp file.hwpx`

## 제한 사항

- **HWP 5.0 이미지 작업 불가** — HWPX로 변환 필요
- **암호화된 파일 불가** — 비밀번호/DRM 보호 문서는 열 수 없음
- **매크로, 수식, 차트, OLE 객체 미지원**
- **문단 수준 서식 불가** — 글자 서식만 지원 (굵게, 기울임, 밑줄, 글꼴, 크기, 색상)
- **구조 편집 불가** — 새 문단, 행, 섹션 추가 불가; 기존 내용만 편집 가능
- **그룹화된 도형 미지원** — 개별 텍스트 박스만 지원

## 에러 처리

모든 에러는 JSON으로 반환됩니다:

```json
{
  "error": "Paragraph not found for reference: s0.p999",
  "context": { "ref": "s0.p999", "file": "doc.hwp" },
  "hint": "Valid paragraph refs: s0.p0 through s0.p49"
}
```

## 개발

```bash
bun install
bun run typecheck
bun run lint
bun test src/
bun run build
```

자세한 개발 가이드는 [AGENTS.md](./AGENTS.md)를 참고하세요.

## 감사의 말

- [한컴 OWPML 규격 (KS X 6101)](http://www.hancom.co.kr) — HWPX 포맷 명세
- [hwp.js](https://github.com/hahnlee/hwp.js) — HWP 5.0 바이너리 포맷 이해에 참고한 오픈소스 HWP 파서

## 라이선스

MIT
