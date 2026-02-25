# hwpilot

[![npm](https://img.shields.io/npm/v/hwpilot)](https://www.npmjs.com/package/hwpilot) [![SkillPad - hwpilot](https://img.shields.io/badge/SkillPad-hwpilot-1a1a1a)](https://skillpad.dev/install/devxoul/hwpilot/hwpilot)

---

<div align="center">

[한국어](./README.md) | [English](./README.en.md)

</div>

---

Hwpilot은 AI 에이전트가 HWP/HWPX를 쉽게 다룰 수 있게 해주는 도구입니다. 파일 읽기와 변환만을 지원하는 다른 도구들과는 다르게 HWP 파일을 직접 수정할 수 있습니다.

## 배경

HWP는 여전히 한국에서 가장 많이 사용되는 문서 포맷입니다. 그러나 AI 에이전트들이 MS Office 문서를 쉽게 읽고 쓰는 것에 비해 HWP 문서를 읽고 쓰는 능력은 거의 없다시피 합니다. AI 에이전트를 위한 적절한 도구가 없기 때문입니다. hwpilot을 사용하면 AI 에이전트가 한글 문서를 쉽게 읽고 쓸 수 있습니다.

## 주요 기능

- **읽기 & 검색** — 문단, 표, 텍스트 박스, 이미지를 읽고 검색
- **텍스트 편집** — 문단, 표 셀, 텍스트 박스의 텍스트를 직접 수정
- **서식 편집** — 굵게, 기울임, 밑줄, 글꼴, 크기, 색상 변경
- **인라인 서식** — 문단 내 특정 문자 범위에만 서식 적용 (--start/--end)
- **문단 추가** — 문서에 새 문단을 추가하고 위치 지정 (before/after/end)
- **이미지** — 조회, 추출, 삽입, 교체 (HWPX)
- **새 문서 생성** — 빈 문서를 만들고 내용 채우기
- **포맷 변환** — HWP 5.0 → HWPX 변환

## 에이전트 스킬

hwpilot은 AI 에이전트에게 HWP 문서를 다루는 방법을 가르쳐주는 [에이전트 스킬](https://agentskills.io/)을 포함합니다.

### SkillPad

SkillPad는 에이전트 스킬을 위한 GUI 앱입니다. 자세한 내용은 [skillpad.dev](https://skillpad.dev/)를 참고하세요.

[![Available on SkillPad](https://badge.skillpad.dev/hwpilot/dark.svg)](https://skillpad.dev/install/devxoul/hwpilot/hwpilot)

### Skills CLI

Skills CLI는 에이전트 스킬을 위한 CLI 도구입니다. 자세한 내용은 [skills.sh](https://skills.sh/)를 참고하세요.

```bash
npx skills add devxoul/hwpilot
```

### Claude Code Plugin

```
/plugin marketplace add devxoul/hwpilot
/plugin install hwpilot
```

### OpenCode Plugin

`opencode.jsonc`에 추가:

```jsonc
{
  "plugins": [
    "hwpilot"
  ]
}
```

## 설치

CLI를 직접 사용하려면:

```bash
npm install -g hwpilot
```

## 사용법

모든 명령어는 JSON을 출력합니다. 편집 명령어는 별도의 변환 과정 없이 원본 파일을 직접 수정합니다.

```bash
hwpilot read document.hwpx --limit 20              # 문서 읽기
hwpilot find document.hwpx "청구취지"                # 텍스트 검색
hwpilot edit text document.hwpx s0.p0 "새 내용"     # 문단 편집
hwpilot table edit document.hwpx s0.t0.r0.c0 "값"   # 표 셀 편집
hwpilot table add document.hwpx 3 4                 # 3×4 표 추가
hwpilot table add document.hwpx 2 2 --data '[["A","B"],["C","D"]]'  # 데이터와 함께 표 추가
hwpilot edit format document.hwpx s0.p0 --bold --size 16  # 서식 변경
hwpilot edit format document.hwpx s0.p0 --bold --start 0 --end 5  # 인라인 서식
hwpilot paragraph add document.hwpx s0 "새 문단" --position end  # 문단 추가
hwpilot image insert document.hwpx ./photo.jpg      # 이미지 삽입
hwpilot create new.hwpx                              # 새 문서 생성
hwpilot convert legacy.hwp output.hwpx              # HWP 5.0 → HWPX 변환
```

## 포맷 지원

파일 포맷은 확장자가 아닌 파일 내용(매직 바이트)으로 판별합니다. `.hwp` 확장자라도 실제로는 HWPX일 수 있습니다.

| 기능 | HWPX | HWP 5.0 |
|---|---|---|
| 읽기 | ✓ | ✓ |
| 텍스트 편집 | ✓ | ✓ |
| 서식 편집 | ✓ | ✓ |
| 표 | ✓ | ✓ |
| 텍스트 박스 | ✓ | ✓ |
| 검색 | ✓ | ✓ |
| 이미지 | ✓ | 목록만 |
| 새 문서 생성 | ✓ | ✓ |

HWP 5.0에서 이미지 작업이 필요하면 먼저 HWPX로 변환하세요: `hwpilot convert file.hwp file.hwpx`

## 제한 사항

- **암호화/DRM 문서** — 열 수 없음
- **구조 변경 제한** — 표 추가와 문단 추가는 가능하지만 행, 섹션 추가는 미지원
- **글자 서식만 지원** — 문단 정렬, 줄간격 등 문단 서식은 미지원
- **매크로, 수식, 차트, OLE** — 미지원
- **그룹화된 도형** — 개별 텍스트 박스만 지원

## 개발

```bash
bun install
bun run typecheck
bun run lint
bun test src/
bun run build
```

자세한 개발 가이드는 [AGENTS.md](./AGENTS.md)를 참고하세요.

## 참고한 문서

- [한컴 OWPML 규격 (KS X 6101)](http://www.hancom.co.kr) — HWPX 포맷 명세
- [hwp.js](https://github.com/hahnlee/hwp.js) — HWP 5.0 바이너리 포맷 참고

## 라이선스

MIT
