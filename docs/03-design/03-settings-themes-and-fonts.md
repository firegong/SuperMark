# 설정·테마·폰트·Windows 표시 상세 설계서

- **문서 번호**: `DES-003`
- **작성일**: 2026-11-21
- **상태**: v1.0 (현재 구현 기준)
- **관련 문서**: `ARCH-001` 시스템 아키텍처, `DES-002` 마크다운 파서와 프리뷰

---

## 1. 목적과 범위

사용자 설정의 저장·마이그레이션·반영 흐름, 설정 화면, 에디터·프리뷰 테마, 번들 폰트, Windows 화면 맞춤을 정의한다.

---

## 2. 설정 저장소

### 2.1 위치와 형식

| 항목 | 내용 |
| --- | --- |
| 파일 | `<config_dir>/MarkEdit/settings.json` — Windows `%APPDATA%\MarkEdit\settings.json`, macOS `~/Library/Application Support/MarkEdit/settings.json` (앱 이름 변경 후에도 기존 사용자 데이터를 유지하기 위해 폴더 이름은 그대로) |
| 관리 | Rust `SettingsManager` (`src-tauri/src/settings/mod.rs`) |
| 형식 | 점 표기 키의 평면 JSON. 저장 시 모든 필드를 기록 |

| 범주 | 키 |
| --- | --- |
| `editor.*` | `fontFamily`, `fontSize`, `lightTheme`, `darkTheme`, `themeExtension`, `showLineNumbers`, `showActiveLineIndicator`, `invisiblesBehavior`, `typewriterMode`, `focusMode`, `livePreview`, `lineWrapping`, `lineHeight`, `tabKeyBehavior`, `indentUnit` |
| `assistant.*` | `insertFinalNewline`, `trimTrailingWhitespace`, `wordsInDocument`, `autoCharacterPairs`, `smartQuotes` |
| `general.*` | `appearance`, `newFilenameExtension`, `defaultTextEncoding`, `defaultLineBreak`, `startupBehavior`, `checkForUpdates`(기본 켜짐), `skippedUpdateVersion`(업데이트 대화상자에서 건너뛴 버전) |
| `window.*` | `reduceTransparency` |
| `preview.*` | `markdownRenderer`, `diagramServer`, `diagramRendering`, `plantumlCommand`, `d2Command`, `themeStyles` |
| `meta.*` | `settingsRevision` |

### 2.2 읽기와 마이그레이션

1. 기본값(`UserSettings::default()`) 위에 파일의 키를 덮어쓴다. 프런트엔드식 이름(`fontSize`, `theme` 등)도 정규 키로 바꿔 받는다(`canonical_setting_key`).
2. `migrate_settings`가 `meta.settingsRevision`에 따라 한 번만 값을 바꾼다. 모든 필드가 저장되므로, 기본값만 바뀌어서는 기존 파일에 반영되지 않기 때문이다.

| 리비전 | 변경 |
| --- | --- |
| 2 | `window.reduceTransparency` 기본값 켬. 이전 파일의 `false`를 한 번 `true`로 |
| 3 | 편집기 기본 폰트 D2Coding. 이전 기본값(`Cascadia Mono, Consolas, ui-monospace, monospace`, 설정 화면에서 고를 수 없던 값)만 바꾸고, 사용자가 고른 폰트는 유지 |

3. 프런트엔드는 받은 값을 다시 검증한다(`normalizeUserSettings`): 열거형은 허용값만, 숫자는 범위 안(글자 크기 8~72, 줄 간격 1~3), 프리뷰 스타일은 `normalizePreviewThemeStyles`.

### 2.3 변경 반영 흐름

```text
설정 화면 ──applyLocalChange──▶ 현재 창에 즉시 적용
     └──invoke('settings_update', { patch })──▶ Rust: 저장
                                                  └─ build_live_sync_js ──eval──▶ 모든 창
                                                       (config 세터, 테마, 파서, 다이어그램, 프리뷰 스타일 …)
```

---

## 3. 설정 화면 (`chrome/settingsModal.ts`)

| 탭 | 섹션 | 항목 |
| --- | --- | --- |
| Editor | Font / Theme / Display / Edit Behavior / Indentation | 폰트(기본 D2Coding), 크기, **테마 드롭다운(색상 미리보기)**, Get More Themes, 줄 번호, 현재 줄 표시, 공백 문자 표시, 에디터 내 라이브 프리뷰, 줄 바꿈, 타자기 모드, 포커스 모드, 줄 간격, Tab 키 동작, 들여쓰기 단위 |
| Preview | Theme / Typography | 테마별 프리뷰 스타일 편집 대상, 샘플, 요소별 글꼴·크기·굵기·색 |
| Assistant | Format Files / Words & Characters | 마지막 줄바꿈 추가, 줄 끝 공백 제거, 입력 중 단어 제안, 괄호 자동 쌍, 스마트 따옴표 |
| General | General / Diagrams | 시작 동작, 자동 업데이트 확인, 모양(시스템/밝게/어둡게), 새 파일 확장자, 기본 인코딩, 기본 줄바꿈, 마크다운 파서, 다이어그램 렌더링·서버·PlantUML·D2 명령 |
| Window | Window | 투명도 줄이기(기본 켬) |

- 테마 드롭다운은 각 테마의 색상 견본을 보여 주는 커스텀 listbox이며 키보드(↑↓, Home/End, Enter/Space, Esc)와 스크린리더를 지원한다. Esc는 목록만 닫는다.
- 대화상자의 창 버튼(macOS 스타일)은 네이티브 macOS 26 치수와 같다: 14×14px, 중심 간격 23px.

---

## 4. 에디터 테마

| 항목 | 내용 |
| --- | --- |
| 내장 테마 | 16종 (`src/styling/themes/`): GitHub, Xcode, Winter is Coming, Minimal, Solarized, Rosé Pine(Dawn)의 밝게/어둡게, Dracula, Cobalt, SynthWave '84, Night Owl |
| 구성 | 테마 = 편집기 색상(`EditorColors`) + 구문 강조 스타일(`HighlightStyle`) |
| 모양 전환 | 모양을 어둡게/밝게로 바꾸면 `-light` ↔ `-dark` 짝 테마로 전환 |
| 테마 확장 | MarkEdit 테마 확장(`window.__markeditTheming__`)은 스크립트 실행 중 기여분을 기록해 두고, 설정에서 고른 확장의 색만 적용한다 (`chrome/themeExtensions.ts`). 내장 테마를 고르면 확장 색은 제거 |
| 코드 강조 | 에디터와 프리뷰의 코드 블록 모두 현재 테마의 강조 클래스를 사용 (DES-002 §5) |

---

## 5. 프리뷰 테마

두 층으로 구성되며 사용자 설정이 우선한다.

| 층 | 파일 | 내용 |
| --- | --- | --- |
| 테마 기본값 | `chrome/previewThemePresets.ts` | 내장 테마별로 공식 팔레트를 조사해 정한 글꼴·크기·제목/링크/굵게/기울임/코드/인용 색, 표(테두리·머리글 배경·줄무늬·`grid`/`lines`), 형광펜. GitHub는 github-markdown-css의 표 배치(내용 폭, 본문 크기, `6px 13px`, 숫자 정렬) |
| 사용자 스타일 | `chrome/previewThemeStyles.ts` | `preview.themeStyles`: 테마(또는 `extension:<스크립트>`)별 본문·H1~H6·링크·코드·인용의 글꼴·크기·굵기·색 |

- 기본값은 프리뷰 창의 `--pv-*` CSS 변수로, 사용자 스타일은 더 구체적인 선택자의 규칙으로 각각 별도 `<style>`에 기록한다. 테마가 바뀌면(`editor-colors-changed`) 다시 계산한다.
- 모든 테마의 표 머리글은 페이지 배경과 구분되는 배경을 가진다(어두운 테마는 한 단계 밝은 면). 테스트가 대비를 확인한다.
- 사용자 값은 정규화한다: 색은 `#rrggbb`, 크기 8~96px, 굵기 100~900, 글꼴 이름에서 `; : { } < > \` 제거.

---

## 6. 폰트

### 6.1 문제와 원칙

Windows의 Chromium(WebView2)은 글꼴 목록이 일반 계열(`monospace`, `sans-serif`)에 먼저 닿으면 한글에 GulimChe/Gulim을 쓰며, 이 글꼴은 작은 크기를 비트맵으로 그려 계단 현상이 생긴다. 따라서 **모든 글꼴 목록에서 일반 계열보다 앞에 한글 글꼴**을 둔다 (`src/styling/fonts.ts`).

### 6.2 글꼴 목록

| 용도 | 목록 (앞에서부터) |
| --- | --- |
| 편집기 | 설정 글꼴(기본 `D2Coding`) → SF Mono, Menlo, Cascadia Mono, Consolas → Apple SD Gothic Neo, Pretendard Variable, Malgun Gothic → 일반 계열 |
| 화면(UI) | -apple-system, Segoe UI Variable Text, Segoe UI → 한글 글꼴 → system-ui, sans-serif |
| 코드(에디터·프리뷰 기본) | D2Coding → ui-monospace … → 한글 글꼴 → monospace |
| 프리뷰 테마 | 각 테마 글꼴 + `withHangulFallbacks()`로 한글 글꼴 삽입 |

- macOS는 Apple SD Gothic Neo가 먼저 쓰이므로 기존 모양이 유지된다.
- 한글 글꼴(Pretendard)도 라틴 글자를 가지므로, 고정폭 목록에서는 라틴 고정폭 글꼴을 그보다 앞에 둔다.

### 6.3 번들 폰트

| 폰트 | 용도 | 파일 (`dist/fonts/`) | 출처·라이선스 |
| --- | --- | --- | --- |
| D2Coding | 편집기 기본. 한글이 정확히 2칸 폭 | `D2Coding-Regular.woff2`(1.5MB), `D2Coding-Bold.woff2`(1.6MB) | npm `d2coding`, OFL-1.1 (NAVER), `D2Coding-LICENSE.txt` |
| Pretendard Variable | 한글 대체(UI·프리뷰·편집기) | `PretendardVariable.woff2`(2.0MB, 굵기 45~920) | npm `pretendard`, OFL-1.1, `Pretendard-LICENSE.txt` |

- vite 플러그인 `vendorFonts`(`packages/core-editor/vite.config.mts`)가 빌드 시 `node_modules`에서 복사한다(단일 파일 번들에 넣지 않음). 개발 서버에서는 같은 경로로 제공한다.
- `installBundledFonts()`가 시작 시 `@font-face`를 등록한다. 설치된 D2Coding이 있으면 `local()`이 우선한다. 브라우저는 필요한 글자가 있을 때만 파일을 읽는다.

---

## 7. Windows 화면 맞춤

| 항목 | 설계 |
| --- | --- |
| 투명도 | 패널(검색 바, 팝오버, 대화상자)의 반투명 블러는 Windows에서 ClearType을 끈다. `window.reduceTransparency` 기본 켬 → 불투명 |
| 창 크기 | Windows에서 새 창을 모니터 작업 영역의 60%×80%(800~1400 × 600~1000 논리 픽셀)로 열고 첫 창은 가운데 배치. macOS는 960×680 |
| 스크롤바 | `<html data-platform="windows">`일 때 Windows 11 스타일의 얇고 둥근 스크롤바 |
| 창 버튼 | 대화상자는 플랫폼에 따라 macOS 신호등 버튼 또는 Windows 닫기 버튼 |
