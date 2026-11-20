# 마크다운 파서와 프리뷰 상세 설계서

- **문서 번호**: `DES-002`
- **작성일**: 2026-11-21
- **상태**: v1.0 (현재 구현 기준)
- **관련 문서**: `ARCH-001` 시스템 아키텍처, `DES-003` 설정·테마·폰트

---

## 1. 목적과 범위

에디터 옆 프리뷰(분할/마크다운 보기)에 마크다운을 HTML로 그리는 부분의 구조를 정의한다.
파서와 프리뷰를 **파일 단위로 분리**하여, 한 파서(또는 한 종류의 프리뷰)를 다른 것에 영향 없이 갱신하거나 교체할 수 있게 하는 것이 핵심 원칙이다.

- 파서: 마크다운 텍스트 → HTML (TypeScript로 구현, 앱에 내장)
- 프리뷰: 파서 출력을 프리뷰 창에 표시하는 방식 (HTML 조각 삽입, 격리 프레임 등)
- 공통 기능: 스크롤 동기화, 체크박스 토글, 코드 복사, 링크 처리, 다이어그램·수식·코드 강조

---

## 2. 디렉터리 구성

```text
packages/core-editor/src/
├─ modules/markdown-renderer/
│  ├─ index.ts                 파서 목록 관리, 활성 파서 전환, 렌더 진입점
│  ├─ types.ts                 MarkdownRendererEngine 등 공통 인터페이스
│  ├─ utils.ts                 escapeHtml, isUnsafeUrl, slugify …
│  ├─ core/blockEngine.ts      CommonMark·GFM·Extended가 공유하는 블록/인라인 엔진
│  ├─ parsers/
│  │  ├─ index.ts              내장 파서 목록(메뉴 순서)과 기본 파서
│  │  ├─ commonmark.ts         CommonMark (엄격)
│  │  ├─ gfm.ts                GitHub Flavored Markdown
│  │  ├─ extended.ts           Extended (기본값)
│  │  ├─ markdownSuperSet/     Markdown Super Set (자체 엔진: engine·blocks·inline·attributes·html·context)
│  │  └─ markdownIt.ts         markdown-it (MarkEdit Preview 확장이 제공할 때만)
│  └─ plugins/                 다이어그램·수식·코드 강조 렌더러 플러그인
└─ chrome/
   ├─ markdownPreview.ts       프리뷰 창: 레이아웃, 갱신, 스크롤 동기화, 공통 상호작용
   ├─ preview/
   │  ├─ index.ts              파서별 프리뷰 선택 (previewFor, setParserPreview)
   │  ├─ types.ts              PreviewRenderer, PreviewHost
   │  ├─ htmlPreview.ts        HTML 조각 삽입 (CommonMark, GFM, Extended)
   │  ├─ framePreview.ts       완전한 HTML 문서를 격리 프레임에 표시 (markdown-it)
   │  └─ superSetPreview.ts    Markdown Super Set 전용: 파일 포함(@include), 탭 세트
   ├─ includeLoader.ts         @include 파일 미리 읽기·캐시
   ├─ scrollSync.ts            에디터 ⇄ 프리뷰 스크롤 위치 계산
   ├─ previewThemePresets.ts   테마별 프리뷰 기본 스타일 (DES-003)
   └─ previewThemeStyles.ts    사용자 프리뷰 스타일 (DES-003)
```

---

## 3. 파서

### 3.1 인터페이스

모든 파서는 `MarkdownRendererEngine`(`types.ts`)을 구현한다.

| 멤버 | 설명 |
| --- | --- |
| `id` | 설정에 저장되는 식별자 (`commonmark`, `gfm`, `extended`, `super`, `markdown-it`). **교체 시에도 유지해야 한다.** |
| `name` | View → Markdown Parser 메뉴와 설정에 표시되는 이름 |
| `standard` | 문법 표준 식별자 |
| `render(markdown, options?)` | 동기 렌더링 → HTML 조각 |
| `renderAsync?(markdown)` | 비동기 렌더링 (확장 제공 렌더러) |
| `renderDocument?(markdown)` | 자체 스타일이 포함된 **완전한 HTML 문서**. 있으면 프레임 프리뷰로 표시 |
| `renderInline?`, `renderMath?`, `renderMermaid?` | 보조 렌더링 |

### 3.2 내장 파서

| 파서 (id) | 파일 | 엔진 | 문법 |
| --- | --- | --- | --- |
| CommonMark (`commonmark`) | `parsers/commonmark.ts` | `core/blockEngine.ts` | 핵심 문법만. 표·작업 목록·취소선·각주·수식·다이어그램·코드 강조 없음 |
| GitHub Flavored Markdown (`gfm`) | `parsers/gfm.ts` | 〃 | CommonMark + 표, 작업 목록, 취소선, 자동 링크, 각주, 코드 강조 |
| Extended Markdown (`extended`, 기본값) | `parsers/extended.ts` | 〃 | GFM + front matter, 수식, Mermaid 등 다이어그램, 콜아웃 |
| Markdown Super Set (`super`) | `parsers/markdownSuperSet/` | 자체 엔진 | MultiMarkdown 6 + Pandoc·GFM·Obsidian 문법, 셀 병합, 상호 참조, 실행·렌더 청크, 파일 포함 등 (`docs/05-testing/samples/MarkdownSuperSetGrammar.md`) |
| markdown-it (`markdown-it`) | `parsers/markdownIt.ts` | MarkEdit Preview 확장 | 확장이 설치되어 있을 때만 목록에 추가. `renderDocument`로 완전한 문서를 반환 |

- CommonMark·GFM·Extended는 같은 엔진(`DefaultMarkdownEngine`)의 인스턴스이며, 각 파일이 자신의 **문법 기능 표(`SyntaxFeatures`)**를 정의한다.
- `parsers/index.ts`의 `builtInParsers`가 메뉴 순서를 정한다. 파서 추가는 파일을 만들고 이 목록에 한 줄을 더하는 것으로 끝난다.
- 내장 확장(Markdown Super Set)은 Extensions → Installed에서 끌 수 있다. 꺼진 파서는 목록에서 사라지고, 활성 파서였다면 다른 파서로 바뀐다(`setMarkdownRendererAvailable`).

### 3.3 교체·갱신 규칙

1. 해당 파서 파일(또는 폴더)만 수정한다.
2. 같은 이름으로 `MarkdownRendererEngine`을 export하고 **`id`를 유지**한다(사용자 설정 호환).
3. 출력 HTML은 공통 상호작용을 위해 다음 관례를 따른다: 블록에 `markedit-preview-block` 클래스와 `data-line`(0부터 시작하는 원본 줄 번호), 작업 목록 체크박스에 `markedit-preview-task-checkbox`와 `data-line`, 표에 `markedit-preview-table`, 코드 블록에 `markedit-preview-code-block`.

### 3.4 공통 엔진(`core/blockEngine.ts`)의 처리 순서

줄 분류 → (front matter) → 블록 반복: 수평선 → 제목 → 펜스 코드(다이어그램 플러그인 포함) → 표 → 콜아웃(`> [!note]`) → 목록 → 인용 → 수식 블록 → 사용자 블록 플러그인 → 문단. 문단 안의 인라인 문법(코드 스팬, 링크·이미지, 강조, 수식, 각주 등)은 `parseInline`이 처리한다.

- 펜스: 백틱/물결 3개 이상, 닫는 펜스는 같은 문자로 같거나 더 길고 뒤에 공백만 허용 (CommonMark 규칙).
- 중첩 한도: 인용·목록 등은 재귀로 그리므로 **64단계**를 넘으면 나머지를 일반 텍스트로 표시한다(스택 넘침 방지). Markdown Super Set 엔진도 같다.

---

## 4. 프리뷰

### 4.1 구조

```text
에디터 변경 ─(MutationObserver, 50ms 지연)─▶ markdownPreview.updateContent()
   └─ engine = 활성 파서
   └─ previewFor(engine).render(body, text, engine, previewHost)
         ├─ htmlPreview      : body.innerHTML = engine.render(text) → host.didRenderHtml()
         ├─ superSetPreview  : engine.render(text, includeOptions) + 탭 세트 → host.didRenderHtml()
         └─ framePreview     : engine.renderDocument(text) → <iframe sandbox="allow-same-origin"> → host.didLoadFrame()
```

| 인터페이스 | 역할 |
| --- | --- |
| `PreviewRenderer` | `render(body, text, engine, host)` — 한 종류의 프리뷰 |
| `PreviewHost` (`markdownPreview.ts`가 제공) | `rerender()`, `didRenderHtml(body)`(공통 상호작용 연결·스크롤 재정렬·다이어그램 수화), `didLoadFrame(doc)`, `didChangeLayout()` |

- 파서 → 프리뷰 매핑: `preview/index.ts`의 표에 명시된 것(`super` → `superSetPreview`)이 우선이고, 없으면 `renderDocument`가 있으면 `framePreview`, 아니면 `htmlPreview`. 확장 파서는 `setParserPreview(parserId, preview)`로 지정할 수 있다.
- 프레임 프리뷰는 다른 프리뷰로 바뀌면 진행 중인 렌더를 버린다(`removePreviewFrame`이 토큰을 증가).
- 테마가 바뀌면(`editor-colors-changed`) 프리뷰를 다시 그린다(코드 강조 클래스가 테마에 따라 달라지므로).

### 4.2 공통 상호작용 (`markdownPreview.ts`)

| 기능 | 동작 |
| --- | --- |
| 작업 목록 체크박스 | 클릭 시 원본 줄의 `[ ]` ↔ `[x]`(및 `[/]`, `[-]`)를 에디터에서 바꾼다 |
| 블록 더블클릭 | 해당 원본 줄로 커서 이동 |
| 코드 복사 | 코드 블록의 Copy 버튼 |
| Mermaid 원본 보기 | 다이어그램/원본 전환 |
| 링크 | 페이지 이동 금지. `#앵커`는 프리뷰 안에서 스크롤, 그 밖은 호스트 `open_link`로 전달(ARCH-001 §6 보안) |
| 스크롤 동기화 | `data-line` 앵커 사이를 선형 보간. 기준점이 뷰포트 위→아래로 이동하여 양쪽이 함께 처음·끝에 도달. 편집 중이거나 선택 영역이 있으면 일시 정지. 프레임 프리뷰는 제목 텍스트로 매칭 |

### 4.3 Markdown Super Set 전용 (`superSetPreview.ts`)

- `@include 경로`: 렌더링이 동기이므로 포함 파일을 미리 읽어 캐시하고(`includeLoader.ts`), 처음 보는 파일은 호스트에서 읽어 오는 동안 "loading" 줄을 표시한 뒤 도착하면 다시 그린다. 문서가 바뀌거나 창이 다시 포커스되면 캐시를 비운다.
- 탭 세트(§26): 탭 버튼 클릭으로 패널을 전환하고 스크롤 앵커를 무효화한다.

---

## 5. 렌더러 플러그인 (`modules/markdown-renderer/plugins/`)

| 플러그인 | 파일 | 설명 |
| --- | --- | --- |
| 다이어그램 레지스트리 | `registry.ts`, `builtin.ts` | ` ```mermaid`, `plantuml`, `d2`, `drawio` 등. 확장은 `MarkEdit.registerDiagramPlugin`으로 추가. 동기 렌더 후 비동기 작업은 `hydrate`에서 완료 |
| 렌더링 전략 | `strategy.ts`, `local.ts`, `kroki.ts` | `auto`(로컬 → 서버), `local`, `server`. 로컬: PlantUML·D2는 호스트 명령(`diagram_render_local`), Mermaid는 번들된 `dist/vendor/mermaid.min.js`. 서버: Kroki 호환 서버의 SVG를 `<img>`로 표시(스크립트 실행 불가). 결과는 원본 기준으로 캐시 |
| 수식 | `mathPlugin.ts` | LaTeX → MathML(오프라인, Chromium이 직접 렌더). 알 수 없는 명령은 오류로 표시 |
| 코드 강조 | `codeHighlightPlugin.ts`, `syntaxHighlight.ts` | 언어별 파서로 토큰화하고 **현재 에디터 테마의 강조 클래스**를 붙인다. 언어 목록은 `src/codeLanguages.ts`(약 60개, `@codemirror/legacy-modes`)를 에디터·프리뷰·Quick Look이 공유. MarkEdit-language-data 확장이 있으면 그 파서를 우선. 모르는 언어는 범용 토크나이저 |

---

## 6. 안전성

| 위협 | 대응 |
| --- | --- |
| 원시 HTML의 스크립트 | 공통 엔진은 HTML을 이스케이프. Markdown Super Set은 `parsers/markdownSuperSet/html.ts`의 태그 단위 필터(script·style·iframe·form 등 차단, 이벤트 속성 제거) |
| 위험한 URL | `isUnsafeUrl`: 제어 문자를 제거한 뒤 `javascript:`, `vbscript:`, `data:` 차단 |
| 확장 렌더러의 문서 | `sandbox="allow-same-origin"`(스크립트 불가) 프레임에 격리, 앱 CSS와 분리 |
| 링크 클릭 | 호스트 `open_link`가 http(s)/mailto만 외부로, 문서는 앱에서, 그 밖의 파일은 탐색기에서 표시만(실행 금지) |
| 다이어그램 서버 출력 | `<img>`로만 표시 |
| 병적 입력 | 중첩 64단계 제한, 긴 문단 선형 처리. `test/robustness.test.ts`가 `docs/05-testing/samples/malformed/` 샘플과 생성 입력으로 검증 |

---

## 7. 테스트

| 테스트 | 범위 |
| --- | --- |
| `test/parsersAndPreviews.test.ts` | 파서 목록·id, 파서별 문법 차이, 파서→프리뷰 매핑, 프리뷰 교체, 프레임 렌더 취소 |
| `test/superMarkdown.test.ts`, `superMarkdownMetadata.test.ts` | Markdown Super Set 문법 전반, 한글 메타데이터 키 |
| `test/syntaxHighlight.test.ts` | 언어별 토큰화, 테마 클래스, 4개 이상 백틱 펜스 |
| `test/robustness.test.ts` | 깨진·적대적·무작위 입력에서 예외·지연·스크립트 없음 |
| `test/previewLinks.test.ts` | 링크 클릭 처리 |
| `test/rendererPlugins.test.ts`, `markdownItParser.test.ts`, `includeLoader.test.ts`, `scrollSync.test.ts` | 플러그인, markdown-it, 파일 포함, 스크롤 동기화 |
