# MarkEdit Windows 포팅 타당성 및 아키텍처 분석서

- **문서 번호**: `REQ-001`
- **작성일**: 2026-11-08
- **대상 업스트림**: [`MarkEdit-app/MarkEdit`](https://github.com/MarkEdit-app/MarkEdit) (`v1.37.1` 기준)
- **선택 기술 스택**: **옵션 1 — Tauri v2 (Rust + Microsoft Edge WebView2) + `CoreEditor` 재사용**

---

## 1. 검토 요약 (Executive Summary)

MarkEdit를 Windows로 포팅할 때 **Swift 소스코드를 Windows에서 그대로 재컴파일하는 직접 포팅 방식은 불가능**에 가깝습니다. 전체 코드의 약 67%를 차지하는 Swift 계층이 `AppKit`, `NSDocument`, `WKWebView`, `NSSpellChecker` 등 macOS 전용 프레임워크에 강하게 결합되어 있기 때문입니다.

그러나 **핵심 에디터 엔진인 `CoreEditor`(TypeScript/CodeMirror 6)와 양방향 RPC 브리지 계약(`ts-gyb` 기반 코드 생성 구조)을 그대로 재사용하고, 호스트 셸만 Tauri v2(Rust + WebView2)로 구축하는 하이브리드 포팅은 기술적 타당성이 매우 높습니다.**

---

## 2. 원본 MarkEdit 저장소 구조 및 코드 비중 분석

GitHub `MarkEdit-app/MarkEdit` (`main` 브랜치) 기준 언어별 비중과 모듈 구성은 다음과 같습니다.

### 2.1 언어별 코드 비중

| 언어 | 바이트 수 | 비중 | 파일 수 | 주요 역할 |
| :--- | ---: | ---: | ---: | :--- |
| **Swift** | 1,302,292 B | **67.1%** | 328개 | macOS 창/문서 수명주기(`NSDocument`), 네이티브 UI(`AppKit`), `WKWebView` 브리지 |
| **TypeScript** | 617,903 B | **31.8%** | 226개 | CodeMirror 6 마크다운 편집기(`CoreEditor`), 브리지 인터페이스, 확장 런타임 |
| **Mustache** | 7,134 B | 0.4% | 7개 | `ts-gyb` 기반 TypeScript → Swift 브리지 코드 자동 생성 템플릿 |
| **JavaScript / CSS / HTML** | 13,385 B | 0.7% | 20개+ | 번들 엔트리(`index.html`), 스타일시트, 서드파티 렌더러 |

### 2.2 핵심 디렉터리별 역할 및 Windows 재사용성 평가

| 디렉터리 | 세부 구성 | 역할 및 의존성 | Windows 재사용률 |
| :--- | :--- | :--- | :---: |
| **`CoreEditor/`** | 283개 항목 (`src/` 226개 파일) | CodeMirror 6 + Lezer 기반 마크다운 파서/편집기, 멀티 커서, 코드 폴딩, 검색, TOC, `MarkEdit-api` 확장 시스템. `vite-plugin-singlefile`로 단일 HTML 번들 생성 | **90~95%** |
| **`CoreEditor/src/@codegen/`** | `config.json` + Mustache 7종 | `src/config.ts`, `src/bridge/native/*.ts`, `src/bridge/web/*.ts` AST를 파싱해 네이티브 바인딩 자동 생성 | **100%** (Rust 템플릿 추가) |
| **`MarkEditCore/`** | 41개 항목 (Swift 6.2) | 에디터 설정 직렬화 및 `EditorSharedTypes.swift` 공유 타입 정의 | **구조 1:1 이식** (Rust `serde` 구조체로 자동 생성) |
| **`MarkEditKit/`** | 71개 항목 (Swift 6.2) | `WKWebView` 메시지 핸들러(`WKScriptMessageHandlerWithReply`) 및 생성된 Native/Web 브리지 디스패처 | **구조 1:1 이식** (Tauri IPC / WebView2 어댑터로 대체) |
| **`MarkEditMac/`** | 328개 항목 (`AppKit`) | `NSDocument` 기반 파일 I/O, 메뉴바, 찾기/바꾸기 패널, 설정 창(`SettingsUI`), `DiffKit`, `FileVersion`, `TextBundle`, `Statistics` | **재작성 필요** (Tauri 창/메뉴 + 호스트 UI로 대체) |
| **`QuickLookMac/`** | 15개 항목 | macOS Finder QuickLook 확장 | **제외** (추후 Windows PowerToys Peek / Explorer Preview Handler로 선택 구현) |
| **`UpdateInstaller/`** | 23개 항목 | macOS 번들 교체 업데이터 | **대체** (`tauri-plugin-updater` 사용) |

---

## 3. 핵심 기술적 발견: 브리지(Bridge) 분리 구조의 우수성

MarkEdit 포팅이 수월한 가장 결정적인 이유는 **웹 에디터(`CoreEditor`)와 네이티브 호스트 간의 통신이 단 두 개의 추상화 지점으로 완벽히 격리**되어 있기 때문입니다.

### 3.1 Web → Native 호출 (`CoreEditor/src/bridge/nativeModule.ts`)

`CoreEditor` 내 모든 네이티브 요청은 ES6 `Proxy`를 통해 단일 포맷 메시지(`{ moduleName, methodName, parameters }`)로 직렬화됩니다.

```typescript
// CoreEditor/src/bridge/nativeModule.ts
export function createNativeModule<T extends NativeModule>(moduleName: string): T {
  return new Proxy({} as T, {
    get(_target, p) {
      if (typeof p !== 'string') return undefined;
      return args => new Promise((resolve, reject) => {
        const message = {
          moduleName,
          methodName: p,
          parameters: JSON.stringify(args ?? {}),
        };
        if (isReleaseMode) {
          window.webkit?.messageHandlers?.bridge?.postMessage(message).then(resolve, reject);
        }
      });
    },
  });
}
```

- **Windows 포팅 해법**:
  `nativeModule.ts`에서 `window.__TAURI_INTERNals__.invoke('bridge_invoke', message)`를 호출하거나, 초기화 스크립트에서 `window.webkit.messageHandlers.bridge.postMessage` 폴리필을 주입하면 **`CoreEditor` 비즈니스 로직을 단 한 줄도 깨뜨리지 않고 Tauri Rust 백엔드와 통신**할 수 있습니다.

### 3.2 Native → Web 호출 (`window.webModules`)

`CoreEditor/index.ts`는 부트스트랩 시 `window.webModules` 전역 객체에 12개 제어 모듈을 등록합니다.

```typescript
window.webModules = {
  config: new WebModuleConfigImpl(),
  core: new WebModuleCoreImpl(),
  completion: new WebModuleCompletionImpl(),
  history: new WebModuleHistoryImpl(),
  lineEndings: new WebModuleLineEndingsImpl(),
  selection: new WebModuleSelectionImpl(),
  format: new WebModuleFormatImpl(),
  search: new WebModuleSearchImpl(),
  toc: new WebModuleTableOfContentsImpl(),
  api: new WebModuleAPIImpl(),
  writingTools: new WebModuleWritingToolsImpl(),
  foundationModels: new WebModuleFoundationModelsImpl(),
};
```

- **Windows 포팅 해법**:
  Tauri Rust 호스트에서 `webview.eval("window.webModules.<module>.<method>(...)")` (응답이 필요한 경우 Promise 콜백 브리지 헬퍼 경유)를 호출하면 텍스트 로드, 마크다운 포맷팅, 검색, TOC 추출, 설정 변경 등 모든 에디터 기능을 즉시 제어할 수 있습니다.

---

## 4. 포팅 기술 스택 비교 및 옵션 1(Tauri v2) 선정 근거

| 평가 항목 | **옵션 1: Tauri v2 (Rust + WebView2)** ⭐ 선정 | 옵션 2: WinUI 3 / WPF (.NET 8 + WebView2) | 옵션 3: Electron |
| :--- | :--- | :--- | :--- |
| **설치 파일 크기** | **~3 ~ 5 MB** (원본 MarkEdit 4MB와 동급) | ~10 ~ 25 MB | 80 ~ 120 MB+ |
| **메모리/시작 속도** | OS 내장 WebView2 공유 + Rust 네이티브 바이너리로 즉시 기동 | 빠름 (.NET 런타임 초기화 비용 존재) | Chromium 중복 번들로 무거움 |
| **네이티브 메뉴/창 제어** | `muda` 기반 네이티브 Win32 메뉴바, 다중 창, 타이틀바/Mica 효과 기본 지원 | WinUI 3 컨트롤 직접 사용 가능 | 프레임리스 웹 구현 또는 제한적 메뉴 |
| **코드 생성(`ts-gyb`) 궁합** | TypeScript 타입 → Rust `struct`/`enum`(`serde`) 자동 생성 용이 | TypeScript → C# DTO 자동 생성 가능 | 불필요 (Node IPC) |
| **향후 확장성** | 동일 코드베이스로 **Linux (`webkit2gtk`) 빌드까지 즉시 확장 가능** | Windows 전용에 종속 | 크로스플랫폼이나 무거움 |

---

## 5. `CoreEditor` 내 macOS 종속 요소 및 패치 대상

`CoreEditor`는 웹 표준 기술로 작성되어 있으나 아래 4가지 영역에서 macOS(Safari/WKWebView) 가정이 존재하므로 포팅 시 경량 패치가 필요합니다.

1. **`package.json`의 `browserslist`**:
   - 현재 `"safari >= 18"`로 고정되어 있음 → `"edge >= 120"`, `"chrome >= 120"` 추가.
2. **단축키 및 수정자 키(`Mod` / `Meta` vs `Ctrl`)**:
   - CodeMirror 기본 키맵은 `Mod`(macOS는 `Cmd`, Windows는 `Ctrl`)를 지원하지만, 일부 커스텀 이벤트(`cmdClickToFollow`, `cmdClickToToggleTodo`, `metaKey` 직접 검사 코드)를 플랫폼 감지(`Ctrl-click` 등)로 분기해야 함.
3. **폰트 폴백(`WebFontFace`)**:
   - `sf-mono`, `ui-monospace`, Apple 시스템 폰트 참조 시 Windows의 `Cascadia Mono`, `Consolas`, `Segoe UI`로 자연스럽게 폴백되도록 스타일 보완.
4. **macOS 전용 API 스텁 처리**:
   - `foundationModels` (macOS 26 Apple Intelligence), `writingTools` (macOS Sequoia Writing Tools), `translation`은 Windows 호스트에서 안전한 No-op 또는 향후 OpenAI/Local LLM 연동 인터페이스로 처리.
