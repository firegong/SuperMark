# 양방향 브리지(Native ↔ Web) RPC 명세서

- **문서 번호**: `ARCH-002`
- **작성일**: 2026-11-08 (최초), 2026-11-21 (현재 구현 기준으로 개정)
- **상태**: v2.0
- **기준 소스**: `packages/core-editor/src/bridge/native/*.ts` (7개 모듈), `bridge/web/*.ts` (12개 모듈), `src-tauri/src/bridge/mod.rs`, `src-tauri/src/lib.rs`

상태 표기: ✅ 구현 · ⚠️ 부분 구현 · ⛔ 미구현(무동작 또는 `null` 반환)

---

## 1. 통신 규격

### 1.1 Web → Native (`NativeModule`)

`bridge/nativeModule.ts`가 만드는 메시지:

```json
{
  "moduleName": "core",
  "methodName": "notifyViewDidUpdate",
  "parameters": "{\"contentEdited\":true,\"isDirty\":true,\"selectedLineColumn\":{…}}"
}
```

부트스트랩 스크립트의 폴리필이 원본 CoreEditor의 WebKit 호출을 Tauri로 연결한다.

```javascript
window.webkit = { messageHandlers: { bridge: { postMessage: message =>
  window.__TAURI_INTERNALS__.invoke('handle_bridge_message', { message }) } } };
```

호스트 처리 (`lib.rs` `handle_bridge_message` → `bridge/mod.rs` `dispatch_bridge_message`):

1. **창 정보가 필요한 호출은 먼저 가로챈다**: `api.openDocument`(문서 열기 흐름), `api.showAlert`(비동기 네이티브 대화상자).
2. 나머지는 `dispatch_bridge_message(창 레이블, 메시지, DocumentManager)`가 `(반환값, 후속 JS)`를 돌려준다. 순수 함수라 WebView 없이 테스트한다.
3. 후처리: `core.notifyLinkClicked` → 링크 열기(`follow_link`), `core.notifyViewDidUpdate` → 창 제목, `api.addMainMenuItems`/`openDocument` → 메뉴 재구성, `core.notifyWindowClose` → 창 닫기(닫기 보호 적용). 후속 JS는 `window.eval`로 실행.

### 1.2 Native → Web (`WebModule`)

Rust의 `WebBridge` 도우미가 스크립트를 만들어 `webview.eval`로 실행한다.

| 도우미 | 생성 코드 |
| --- | --- |
| `format_call` | `window.webModules?.<module>?.<method>?.(<json>)` |
| `format_chrome_call` | `window.chromeUI?.<method>?.(…)` |
| `reset_editor`, `reload_document`, `notify_app_ready`, `mark_content_clean` | 자주 쓰는 호출 |

반환값이 필요한 경우 웹 쪽이 직접 Tauri 명령을 호출해 결과를 보낸다(예: 저장 메뉴 → `invoke('save_document_content', { text: getEditorText() })`). 문서와 확장처럼 큰 데이터는 `eval` 대신 명령의 반환값으로 전달한다.

---

## 2. Web → Native 모듈 (7개)

### 2.1 `core`

| 메서드 | 상태 | 호스트 동작 |
| --- | --- | --- |
| `notifyWindowDidLoad` | ✅ | `{ text, restoreText, extensions }` 반환 (복구 텍스트는 한 번만), 진단 로그 |
| `notifyViewDidUpdate` | ⚠️ | `is_dirty` 갱신 → 창 제목 `●` 표시. 줄/열 상태 표시줄은 없음 |
| `notifyEditorDidBecomeIdle` | ✅ | 수정된 상태면 `save_idle_backup`을 호출하는 JS 반환 → 백업 기록 |
| `notifyLinkClicked` | ✅ | Ctrl+클릭한 링크를 `links.rs` 규칙으로 열기 (http(s)/mailto → 시스템, 문서 → 앱, 그 밖의 파일 → 탐색기에서 표시만, 그 외 무시) |
| `notifyWindowClose` | ✅ | 창 닫기 (수정된 경우 저장 확인) |
| `notifyBackgroundColorDidChange`, `notifyViewportScaleDidChange`, `notifyContentHeightDidChange`, `notifyContentOffsetDidChange`, `notifyCompositionEnded`, `notifyLightWarning`, `notifyWindowResize`, `notifyWindowMove` | ⛔ | 무동작 |

### 2.2 `api`

| 메서드 | 상태 | 호스트 동작 |
| --- | --- | --- |
| `openDocument` | ✅ | `open_document_path`: 이미 열린 창 포커스 또는 새 창. 현재 창의 문서를 바꾸지 않음 |
| `saveDocument` / `closeDocument` | ⚠️ | 저장·닫기 스크립트 실행. `saveDocument`는 저장 완료 전에 `true` 반환 |
| `recentDocumentPaths` | ✅ | `recent.json` |
| `addMainMenuItems` | ✅ | Extensions 메뉴에 항목 추가, 선택 시 `webModules.api.handleMainMenuAction`. `stateGetterID`는 미반영 |
| `showContextMenu` | ✅ | 앱 UI의 컨텍스트 메뉴(`chromeUI`) |
| `showAlert` | ⚠️ | 네이티브 대화상자, 누른 버튼의 순번 반환. 버튼 이름 지정은 표준 버튼(OK/Cancel/Yes/No)으로 대체 |
| `showTextBox` | ⚠️ | 입력 상자는 띄우지만 입력 전에 기본값을 반환 |
| `showPrintPanel` | ⚠️ | `window.print()`. 옵션·PDF 내보내기 없음 |
| `showOpenPanel` / `showSavePanel` | ⛔ | `null` |
| `openFile` / `revealFile` | ✅ | 기본 앱으로 열기 / 탐색기에서 표시 |
| `createFile` / `deleteFile` / `moveFile` / `listFiles` / `getFileContent` / `getFileObject`(base64) / `getFileInfo` | ✅ | `std::fs`. 경로가 없으면 현재 문서 |
| `getFileVersions` | ✅ | JSON 문자열 `[{ id, modificationDate(초), isLocal }]` |
| `getFileVersionContent` / `restoreFileVersion` | ✅ | 매개변수 `id`(구 `version`도 허용). ID 형식 검증 |
| `deleteLocalFileVersions` | ✅ | **지정한 `ids`만** 삭제. `ids`가 없으면 아무것도 지우지 않음 |
| `getPasteboardItems` / `getPasteboardString` | ⚠️ | `arboard`로 텍스트만 |
| `terminateApp` / `relaunchApp` / `playSystemBeep` / `runService` | ⛔ | `null` |

### 2.3 그 밖의 모듈

| 모듈 | 상태 | 구현 |
| --- | --- | --- |
| `tokenizer` | ✅ | `tokenize`, `moveWordBackward/Forward` — `unicode-segmentation`(UAX #29), UTF-16 위치 변환 |
| `secretStorage` | ⚠️ | `has/get/set/delete` 동작. 저장은 `secrets.json` **평문** (Windows Credential Manager 연동 예정) |
| `completion` | ⛔ | `null` (단어 제안 없음) |
| `translation` | ⛔ | JSON 문자열 오류 `{"error": "Translation is not available on this platform."}` |
| `foundationModels` | ⛔ | `availability` = unavailable, `isResponding` = false (macOS 전용 기능) |

### 2.4 런타임 정보

`MarkEdit.runtimeInfo()`: 부트스트랩이 `window.config.runtimeInfo = { appVersion, appBuild, osVersion }`을 넣고, `webkitVersion`은 웹 쪽에서 user agent(Chrome/AppleWebKit 버전)로 채운다.

---

## 3. Native → Web 모듈 (12개)

| 모듈 | 주요 메서드 | 호출하는 곳 |
| --- | --- | --- |
| `core` | `resetEditor`, `getEditorText`, `insertText`, `replaceText`, `handleFocusLost`, `restoreFocus` … | 문서 로드·저장, 포커스 |
| `config` | `setTheme`, `setFontFace`, `setFontSize`, `setShowLineNumbers`, `setInvisiblesBehavior`, `setLineWrapping`, `setLineHeight`, `setTabKeyBehavior`, `setIndentUnit`, `setSmartQuotesEnabled` … | 설정 변경, 모든 창 실시간 동기화 |
| `format` | `toggleBold`, `toggleHeading`, `insertCodeBlock`, `insertTable`, `formatContent` … | Format 메뉴, 단축키 |
| `history` | `undo`, `redo`, `markContentClean` | Edit 메뉴, 저장 완료 |
| `lineEndings` | `getLineEndings`, `setLineEndings` | View → Line Endings |
| `search` | `updateQuery`, `findNext`, `replaceAll`, `performOperation`(선택 영역 안에서 모두 바꾸기 등) | 검색 바 |
| `selection` | `gotoLine`, `scrollToSelection`, `selectWholeDocument` … | Go 메뉴, 줄 이동 |
| `toc` | `getTableOfContents`, `gotoHeader`, `selectPrevious/NextSection` | 목차 팝오버, Go 메뉴 |
| `api` | `notifyAppReady`, `handleMainMenuAction`, `handleContextMenuAction`, `getMenuItemState` | 확장 메뉴 |
| `completion` | `startCompletion`, `setState` | (단어 제안 미구현) |
| `writingTools`, `foundationModels` | — | macOS 전용, 호출하지 않음 |

이 밖에 앱 UI는 `window.chromeUI`(검색 바, 설정, 확장 관리자, 프리뷰 모드·파서·스크롤 동기화, 테마 확장, 프리뷰 스타일 등)를 메뉴와 설정 동기화에서 호출한다.

---

## 4. Tauri 명령 (앱 UI ↔ 호스트)

브리지 밖에서 앱 UI가 직접 부르는 명령 27개 (`lib.rs` `generate_handler!`).

| 범주 | 명령 |
| --- | --- |
| 브리지 | `handle_bridge_message` |
| 문서 | `save_document_content`, `save_idle_backup`, `document_content`, `view_state_changed` |
| 링크 | `open_link` |
| 다이어그램 | `diagram_render_local`, `diagram_tools_status` |
| 설정 | `settings_get_state`, `settings_update`, `settings_reset`, `settings_open_file` |
| 버전 | `versions_list`, `versions_get_content`, `versions_restore`, `versions_delete_all` |
| 확장 | `extensions_bootstrap`, `extensions_get_state`, `extensions_install`, `extensions_install_url`, `install_extension_from_url`, `extensions_uninstall`, `extensions_set_enabled`, `extensions_update`, `extensions_set_update_behavior`, `extensions_open_folder`, `extensions_open_homepage` |

---

## 5. 코드 생성과 과제

- `src-tauri/src/bridge/generated/mod.rs`는 손으로 작성되었다. `@codegen/config.json`은 Swift만 렌더링한다. TypeScript 정의와 Rust 구현의 불일치(과거 `getFileVersions` 반환 형식, `translation` 형식)를 막으려면 Rust 대상 렌더링을 추가해야 한다.
- 미구현 항목(⛔)과 부분 구현(⚠️)은 `docs/04-roadmap/01-implementation-roadmap.md`에서 우선순위를 관리한다.
