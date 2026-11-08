# 양방향 브리지(Native ↔ Web) RPC 상세 명세서

- **문서 번호**: `ARCH-002`
- **작성일**: 2026-11-08
- **기준 소스**: `CoreEditor/src/bridge/native/*.ts` (7개 모듈), `CoreEditor/src/bridge/web/*.ts` (12개 모듈)

---

## 1. 통신 프로토콜 규격

### 1.1 Web → Native 요청 페이로드 (`NativeModule`)
`CoreEditor/src/bridge/nativeModule.ts`가 생성하는 메시지 형식입니다.

```json
{
  "moduleName": "core",
  "methodName": "notifyViewDidUpdate",
  "parameters": "{\"contentEdited\":true,\"compositionEnded\":true,\"isDirty\":true,\"selectedLineColumn\":{\"lineNumber\":1,\"columnText\":\"# Hello\",\"selectionText\":\"\"}}"
}
```

- **Tauri IPC 어댑터 구현**:
  ```typescript
  // Windows WebView2 Bridge Polyfill
  window.webkit = {
    messageHandlers: {
      bridge: {
        postMessage: (message: { moduleName: string; methodName: string; parameters: string }) => {
          return window.__TAURI_INTERNALS__.invoke('handle_bridge_message', { message });
        },
      },
    },
  };
  ```

### 1.2 Native → Web 호출 규격 (`WebModule`)
Rust 호스트에서 WebView 내 `window.webModules.<invokePath>.<methodName>(args)`를 호출합니다.
- **반환값이 없는(`void`) 메서드**: `webview.eval(...)`로 즉시 비동기 실행
- **반환값이 있는 메서드**(`getEditorText()`, `getTableOfContents()`, `canUndo()` 등):
  고유 `requestId`를 부여하여 실행 결과를 `invoke("resolve_web_call", { requestId, result })`로 회수하는 경량 RPC 래퍼를 사용합니다.

---

## 2. Web → Native 모듈 전체 명세 (총 7개 모듈)

### 2.1 `core` (`NativeModuleCore`) — **필수(P0)**
| 메서드 | 파라미터 | 반환값 | Windows 호스트 동작 |
| :--- | :--- | :--- | :--- |
| `notifyWindowDidLoad` | 없음 | `void` | 초기 텍스트(`resetEditor`) 주입 및 `notifyAppReady` 호출 |
| `notifyWindowResize` | `{ method: 'to'\|'by', width, height }` | `void` | Tauri `Window::set_size` 호출 |
| `notifyWindowMove` | `{ method: 'to'\|'by', x, y }` | `void` | Tauri `Window::set_position` 호출 |
| `notifyWindowClose` | 없음 | `void` | 미저장 변경사항 확인 후 창 닫기 |
| `notifyEditorDidBecomeIdle` | 없음 | `void` | 백그라운드 자동 백업(Autosave) 및 TOC 갱신 트리거 |
| `notifyBackgroundColorDidChange` | `{ color: Int, alpha: number }` | `void` | WebView2 및 창 배경색 동기화 (깜빡임 방지) |
| `notifyViewportScaleDidChange` | 없음 | `void` | 확대/축소 배율 상태 업데이트 |
| `notifyViewDidUpdate` | `{ contentEdited, compositionEnded, isDirty, selectedLineColumn }` | `void` | 창 타이틀의 Dirty 표시(`*`) 및 상태바 줄/열 번호 갱신 |
| `notifyContentHeightDidChange` | `{ bottomPanelHeight }` | `void` | 레이아웃 여백 조정 |
| `notifyContentOffsetDidChange` | 없음 | `void` | 스크롤 위치 변경 시 열린 팝오버/검색창 동기화 |
| `notifyCompositionEnded` | `{ selectedLineColumn }` | `void` | 한국어/중국어/일본어(CJK) IME 조합 완료 상태 동기화 |
| `notifyLinkClicked` | `{ link: string }` | `void` | 외부 URL은 기본 브라우저(`shell::open`), 로컬 상대경로는 새 창으로 열기 |
| `notifyLightWarning` | 없음 | `void` | 검색 결과 없음 등 경량 경고음/시각 피드백 발생 |

### 2.2 `api` (`NativeModuleAPI`) — **필수(P0)**
| 메서드 | 역할 | Windows 구현 매핑 |
| :--- | :--- | :--- |
| `openDocument` / `saveDocument` / `closeDocument` | 문서 열기/저장/닫기 | Rust 문서 매니저 및 파일 다이얼로그 |
| `recentDocumentPaths` | 최근 문서 경로 배열 반환 | `%APPDATA%/MarkEdit/recent.json` 조회 |
| `addMainMenuItems` / `showContextMenu` | 확장 플러그인 메뉴 추가 및 우클릭 메뉴 표시 | Tauri `muda` 동적 메뉴 생성 및 팝업 |
| `showAlert` / `showTextBox` | 모달 알림창 및 텍스트 프롬프트 표시 | `rfd` 네이티브 메시지 박스 / 프롬프트 모달 |
| `showOpenPanel` / `showSavePanel` / `showPrintPanel` | 열기/저장/인쇄 대화상자 | `tauri-plugin-dialog` + WebView2 `PrintToPdfAsync`/인쇄 |
| `openFile` / `createFile` / `deleteFile` / `moveFile` / `revealFile` / `listFiles` / `getFileContent` / `getFileObject` / `getFileInfo` | 확장용 파일시스템 API | `std::fs` + Windows 탐색기 선택 표시(`explorer /select,`) |
| `getFileVersions` / `getFileVersionContent` / `restoreFileVersion` / `deleteLocalFileVersions` | 로컬 파일 버전 히스토리 관리 | `%APPDATA%/MarkEdit/Versions` 스냅샷 저장소 연동 |
| `getPasteboardItems` / `getPasteboardString` | 클립보드 조회 | `arboard` 또는 `tauri-plugin-clipboard-manager` |
| `terminateApp` / `relaunchApp` / `playSystemBeep` | 앱 종료, 재시작, 시스템 비프음 | Tauri `AppHandle::exit` / `restart`, Win32 `MessageBeep` |

### 2.3 기타 Native 모듈 (5종)
| 모듈 | 메서드 | Windows 구현 전략 |
| :--- | :--- | :--- |
| **`secretStorage`** | `has`, `get`, `set`, `delete` | `keyring` 크레이트로 Windows Credential Locker에 안전하게 저장 |
| **`completion`** | `requestCompletions`, `commitCompletion`, `cancelCompletion`, `selectPrevious/Next/Top/Bottom` | Phase 1에서는 No-op, Phase 3에서 Windows `ISpellChecker` 단어 추천 연동 |
| **`tokenizer`** | `tokenize`, `moveWordBackward`, `moveWordForward` | Unicode Standard Annex #29 (`unicode-segmentation` 크레이트) 기반 단어 경계 계산 |
| **`translation`** | `translate` | 스텁 처리 또는 추후 선택적 번역 API 연동 |
| **`foundationModels`** | `availability`, `createSession`, `isResponding`, `respondTo`, `streamResponseTo` | `availability`에서 `"unavailable"` 반환 (macOS 전용 Apple Intelligence API) |

---

## 3. Native → Web 모듈 전체 명세 (총 12개 모듈)

Rust 호스트(메뉴바, 단축키, 파일 로더 등)가 `window.webModules`를 통해 호출하는 인터페이스입니다.

| 모듈 (`invokePath`) | 주요 메서드 | 호출 시점 |
| :--- | :--- | :--- |
| **`core`** | `resetEditor`, `getEditorState`, `getEditorText`, `getReadableContentPair`, `insertText`, `replaceText`, `performTextDrop`, `handleFocusLost`, `restoreFocus` | 파일 열기/저장 시 본문 추출, 포커스 복구, 드래그 앤 드롭 텍스트 삽입 |
| **`config`** | `setTheme`, `setFontFace`, `setFontSize`, `setShowLineNumbers`, `setShowActiveLineIndicator`, `setInvisiblesBehavior`, `setReadOnlyMode`, `setTypewriterMode`, `setFocusMode`, `setLineWrapping`, `setLineHeight`, `setDefaultLineBreak`, `setTabKeyBehavior`, `setIndentUnit`, `setSuggestWhileTyping`, `setSmartQuotesEnabled` | 메뉴바 토글 또는 `settings.json` 수정 시 즉시 에디터에 반영 |
| **`format`** | `toggleBold`, `toggleItalic`, `toggleStrikethrough`, `toggleHeading`, `toggleBullet`, `toggleNumbering`, `toggleTodo`, `toggleBlockquote`, `toggleInlineCode`, `toggleInlineMath`, `insertCodeBlock`, `insertMathBlock`, `insertHorizontalRule`, `insertHyperLink`, `insertTable`, `formatContent`, `performEditCommand` | 상단 `Format` 메뉴 및 단축키(`Ctrl+B`, `Ctrl+I`, `Ctrl+1~6` 등) 실행 시 호출 |
| **`history`** | `undo`, `redo`, `canUndo`, `canRedo`, `markContentClean` | 파일 저장 완료 직후 `markContentClean()` 호출하여 `isDirty` 초기화 |
| **`lineEndings`** | `getLineEndings`, `setLineEndings` | 문서의 줄바꿈(LF / CRLF) 확인 및 변환 시 호출 |
| **`search`** | `setState`, `updateQuery`, `updateHasSelection`, `performOperation`, `findNext`, `findPrevious`, `replaceNext`, `replaceAll`, `selectAllOccurrences`, `selectNextOccurrence`, `getCounterInfo` | 검색/바꾸기 바(`Ctrl+F`, `Ctrl+H`) 조작 시 호출 |
| **`selection`** | `selectWholeDocument`, `getText`, `getRect`, `scrollToSelection`, `gotoLine`, `refreshEditFocus`, `navigateGoBack` | 특정 줄 이동(`Ctrl+G`), 선택 영역 스크롤 시 호출 |
| **`toc`** | `getTableOfContents`, `getDocumentOutline`, `selectPreviousSection`, `selectNextSection`, `gotoHeader` | 목차(TOC) 드롭다운 클릭 및 이전/다음 섹션 이동 시 호출 |
| **`api`** | `notifyAppReady`, `handleMainMenuAction`, `handleContextMenuAction`, `getMenuItemState` | 확장 플러그인이 등록한 커스텀 메뉴 항목 클릭 시 호출 |
| **`completion`** | `startCompletion`, `setState`, `acceptInlinePrediction` | 자동완성 패널 상태 제어 |
| **`writingTools`** | `setActive`, `ensureSelectionRect` | macOS 전용 기능 (Windows에서는 호출 불필요) |
| **`foundationModels`** | 스트림 응답 콜백 | macOS 전용 기능 (Windows에서는 호출 불필요) |
