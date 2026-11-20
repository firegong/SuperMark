# 시스템 아키텍처 설계서 (Tauri v2 + WebView2 + CoreEditor)

- **문서 번호**: `ARCH-001`
- **작성일**: 2026-11-08
- **상태**: Draft v1.0

---

## 1. 전체 아키텍처 개요

`SuperMark`(구 MarkEdit-Win)은 **Tauri v2 (Rust)** 네이티브 호스트 프로세스와 **Microsoft Edge WebView2** 렌더러 프로세스로 구성되며, 렌더러 내부에서 원본 MarkEdit의 **`CoreEditor` (CodeMirror 6)** 단일 파일 번들이 실행됩니다.

```text
+-----------------------------------------------------------------------------------+
|                            SuperMark (Windows Process)                            |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                     Rust Native Host (src-tauri)                            |  |
|  |                                                                             |  |
|  |  +-------------------+  +--------------------+  +------------------------+  |  |
|  |  | Window & Menu Mgr |  | Document & File IO |  | Settings & Script Loader|  |  |
|  |  | (Tauri / muda)    |  | (Encoding, Watcher)|  | (%APPDATA%/MarkEdit)   |  |  |
|  |  +---------+---------+  +---------+----------+  +-----------+------------+  |  |
|  |            |                      |                         |               |  |
|  |  +---------v----------------------v-------------------------v------------+  |  |
|  |  |             Generated Bridge Dispatcher (ts-gyb -> Rust)              |  |  |
|  |  |  - NativeModules: core, api, completion, tokenizer, secretStorage...  |  |  |
|  |  |  - WebModules Caller: core, config, format, search, history, toc...   |  |  |
|  |  +-----------------------------------+-----------------------------------+  |  |
|  +--------------------------------------|--------------------------------------+  |
|                                         | Tauri IPC / WebView2 Eval               |
|  +--------------------------------------v--------------------------------------+  |
|  |                     Microsoft Edge WebView2 (Renderer)                      |  |
|  |                                                                             |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  |               Bridge Polyfill / Adapter (nativeModule.ts)             |  |  |
|  |  |   window.webkit.messageHandlers.bridge.postMessage -> Tauri invoke    |  |  |
|  |  +-----------------------------------+-----------------------------------+  |  |
|  |                                      |                                      |  |
|  |  +-----------------------------------v-----------------------------------+  |  |
|  |  |                     CoreEditor (CodeMirror 6 + Lezer)                 |  |  |
|  |  |  - window.webModules (12 modules)                                     |  |  |
|  |  |  - window.nativeModules (7 modules)                                   |  |  |
|  |  |  - MarkEdit Extension Runtime (markedit-api)                          |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. 부트스트랩 및 설정 주입 흐름 (Bootstrap Sequence)

원본 MarkEdit의 `CoreEditor/index.html`은 빌드 시점에 플레이스홀더 문자열을 남기고, 네이티브 호스트가 WebView 로드 시 실제 설정 JSON으로 치환하거나 초기화 스크립트로 주입합니다.

```html
<!-- CoreEditor/index.html -->
<script>
  window.config = "{{EDITOR_CONFIG}}";
  MarkEdit = {
    editorConfig: window.config,
    userSettings: "{{USER_SETTINGS}}",
  };
</script>
```

### Windows (Tauri v2) 초기화 시퀀스:
1. **Rust 호스트 기동**:
   - `%APPDATA%/MarkEdit/settings.json`을 읽어들여 해당 창의 초기 `EditorConfig` 구조체를 생성합니다.
   - 명령줄 인자(더블클릭한 `.md` 파일 경로)가 있으면 해당 파일 텍스트를 미리 읽거나 준비합니다.
2. **WebView2 초기화 스크립트(`initialization_script`) 주입**:
   - `window.webkit.messageHandlers.bridge.postMessage` 호환 어댑터를 주입하여 `CoreEditor`가 수정 없이도 Tauri의 `invoke("bridge_message", ...)`를 호출하도록 연결합니다.
   - `window.config` 및 `window.MarkEdit` 초기 객체를 주입하고, 로컬 사용자 확장 스크립트(`__prepareScriptContexts__`)를 등록합니다.
3. **`notifyWindowDidLoad` 핸드셰이크**:
   - `CoreEditor`의 `window.onload`가 실행되면 `window.nativeModules.core.notifyWindowDidLoad()`가 호출됩니다.
   - Rust 호스트는 이 신호를 받은 즉시 `webModules.core.resetEditor({ text, documentChanged: false })` 및 `webModules.api.notifyAppReady()`를 호출하여 문서를 렌더링합니다.

---

## 3. 하이브리드 UI 구성 전략 (툴바·검색 바·통계 뷰)

macOS 버전은 `AppKit`의 `NSFindBar`와 `NSPopover`로 검색 바, 목차(TOC), 통계 팝오버를 그리지만, Windows(Tauri)에서는 다음 두 가지 방식 중 하나로 구현할 수 있습니다.

### 채택 방식: 단일 WebView 내 상단 도킹 크롬(Overlay/Top-Bar) + 네이티브 Win32 메뉴바
- **메뉴바 및 컨텍스트 메뉴**: Tauri의 `muda` 기반 **100% Windows 네이티브 메뉴바 및 우클릭 메뉴**를 사용합니다.
- **검색/바꾸기 바(Find & Replace) 및 TOC/통계 팝오버**:
  - 별도 OS 창을 띄우면 포커스 이동과 위치 동기화 지연이 발생하므로, WebView 상단 레이어(고정 헤더 슬롯)에 경량 UI 컴포넌트로 마운트합니다.
  - 검색 입력 시 즉시 같은 컨텍스트의 `window.webModules.search.updateQuery(...)` / `findNext(...)`를 호출하므로 IPC 왕복 지연이 **0ms**입니다.

---

## 4. `ts-gyb` 기반 코드 생성 파이프라인 확장 설계

원본 `CoreEditor/src/@codegen/config.json`에 Rust 타겟을 추가하여, TypeScript 브리지 정의가 변경될 때마다 Rust 프로토콜 코드가 자동 갱신되도록 구성합니다.

```json
{
  "rendering": {
    "rust": {
      "renders": [
        {
          "target": "config",
          "template": "rust-config.mustache",
          "outputPath": "../../../src-tauri/src/bridge/generated"
        },
        {
          "target": "native",
          "template": "rust-native-module.mustache",
          "outputPath": "../../../src-tauri/src/bridge/generated/native"
        },
        {
          "target": "web",
          "template": "rust-web-module.mustache",
          "outputPath": "../../../src-tauri/src/bridge/generated/web"
        }
      ],
      "namedTypesTemplatePath": "rust-shared-types.mustache",
      "namedTypesOutputPath": "../../../src-tauri/src/bridge/generated/shared_types.rs",
      "typeNameMap": {
        "CodeGen_Int": "i64",
        "CodeGen_UInt64": "u64",
        "CodeGen_Self": "Self",
        "CodeGen_Dict": "serde_json::Map<String, serde_json::Value>"
      }
    }
  }
}
```
이를 통해 수동으로 수십 개의 JSON 직렬화/역직렬화 코드를 작성할 필요 없이 **타입 안전성(Type-safety)을 100% 보장**합니다.
