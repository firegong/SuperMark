# 시스템 아키텍처 설계서 (Tauri v2 + WebView2 + CoreEditor)

- **문서 번호**: `ARCH-001`
- **작성일**: 2026-11-08 (최초), 2026-11-21 (현재 구현 기준으로 개정)
- **상태**: v2.0
- **관련 문서**: `ARCH-002` 브리지 명세, `DES-001` 문서 수명주기, `DES-002` 파서·프리뷰, `DES-003` 설정·테마·폰트

---

## 1. 개요

**SuperMark**(구 SuperMarkdownEdit, MarkEdit-Win)는 macOS 마크다운 에디터 [MarkEdit](https://github.com/MarkEdit-app/MarkEdit)를 Windows로 포팅하고 기능을 확장한 앱이다.

- **네이티브 호스트**: Tauri v2 (Rust, `src-tauri/`, 크레이트 `supermark`)
- **렌더러**: Microsoft Edge WebView2 (macOS 빌드는 WKWebView)
- **에디터**: 원본 MarkEdit의 `CoreEditor` (CodeMirror 6 + Lezer, `packages/core-editor/`)를 기반으로 한 단일 파일 번들 + 앱 자체 UI(chrome)와 프리뷰

```text
+-----------------------------------------------------------------------------------+
|                         SuperMark (네이티브 프로세스, Rust)                          |
|                                                                                   |
|  lib.rs  ── 시작, 창 생성, Tauri 명령(27개), 창 이벤트(닫기 보호), 단일 인스턴스        |
|   ├─ menu/          네이티브 메뉴(muda) 구성·상태·동작 → 웹 호출                      |
|   ├─ document/      DocumentManager: 세션, 인코딩, 저장, 백업, 버전, TextBundle        |
|   ├─ bridge/        웹 브리지 디스패처(core, api, tokenizer, secretStorage …)         |
|   ├─ settings/      settings.json, 마이그레이션, 모든 창 실시간 동기화                 |
|   ├─ extensions/    확장 레지스트리·다운로드(sha256)·설정·내장 확장                    |
|   ├─ diagrams/      로컬 PlantUML·D2·Graphviz 실행                                    |
|   ├─ links.rs       링크 대상 판정(외부/문서/표시만/무시)                              |
|   ├─ updates.rs     앱 자체 업데이트(tauri-plugin-updater, 공개 릴리스 저장소)          |
|   └─ diagnostics.rs 로그 (logs/markedit.log)                                        |
|                                                                                   |
|        ▲ invoke('handle_bridge_message' 등)        │ window.eval(스크립트)           |
+--------|-------------------------------------------|------------------------------+
         |                                           ▼
+-----------------------------------------------------------------------------------+
|                         WebView2 (렌더러, TypeScript)                              |
|                                                                                   |
|  부트스트랩: window.config, MarkEdit.userSettings, runtimeInfo, 브리지 폴리필        |
|  ├─ CoreEditor (src/core.ts, modules/*, styling/*)   CodeMirror 6 편집기             |
|  │    window.webModules (12)  ◀── 호스트 호출                                        |
|  │    window.nativeModules (7) ──▶ 호스트 호출                                       |
|  ├─ chrome/  앱 UI: 검색 바, 목차·통계 팝오버, 설정, 확장 관리자, 버전 기록,          |
|  │          컨텍스트 메뉴, 프리뷰 창                    window.chromeUI               |
|  ├─ modules/markdown-renderer/  형식 모듈(formats/: 형식별 파서 + 프리뷰), 공유 프리뷰  |
|  │                               (preview/), 블록 엔진·mdast(core/), 다이어그램·수식 플러그인 |
|  └─ 확장 런타임 (markedit-api)  사용자 확장 스크립트·스타일, 테마 확장                |
+-----------------------------------------------------------------------------------+
```

---

## 2. 저장소 구성

| 경로 | 내용 |
| --- | --- |
| `src-tauri/` | Rust 호스트 (`Cargo.toml`, `tauri.conf.json`, `src/`) |
| `packages/core-editor/` | 에디터·UI·프리뷰 (TypeScript, vite 단일 파일 빌드 → `dist/`) |
| `docs/` | 요구사항, 아키텍처, 설계, 로드맵, 테스트 계획과 샘플, 릴리스 절차 |
| `scripts/` | `build-app.sh` / `build-app.ps1` (에디터 빌드 + 릴리스 빌드, macOS `.app` 래핑) |
| `.github/workflows/` | CI, 릴리스(서명된 설치 파일과 업데이트 파일을 `firegong/SuperMark-releases`에 게시, 절차는 `docs/06-release/`) |

---

## 3. 프로세스와 통신

| 방향 | 방식 | 용도 |
| --- | --- | --- |
| Web → Native | `__TAURI_INTERNALS__.invoke('handle_bridge_message', { message })` | `window.nativeModules.*` 호출. `window.webkit.messageHandlers.bridge.postMessage` 폴리필로 CoreEditor 코드를 수정 없이 연결 (`ARCH-002`) |
| Web → Native | `invoke('<명령>', args)` | 앱 UI가 쓰는 Tauri 명령: 저장, 설정, 확장, 버전, 링크, 다이어그램 등 (`ARCH-002` §4) |
| Native → Web | `webview.eval(script)` | `window.webModules.*`, `window.chromeUI.*` 호출, 설정 실시간 동기화 |
| Native → Web (데이터) | 명령의 반환값 | 문서 내용과 확장은 큰 `eval` 대신 데이터로 전달 (`notifyWindowDidLoad` 응답, `document_content`, `extensions_bootstrap`) — WebView2에서 수 MB짜리 `eval`이 실패해 창이 비는 문제를 피함 |

---

## 4. 시작 순서

1. **`run()`** (`src-tauri/src/lib.rs`)
   1. 부트스트랩 스크립트 생성 (`build_bootstrap_script`).
   2. 단일 인스턴스 플러그인: 두 번째 실행의 파일 인자를 실행 중인 앱에 넘김(상대 경로는 그 실행의 작업 폴더 기준). 파일이 없으면 기존 창만 앞으로.
   3. `DocumentManager` 등록, 네이티브 메뉴 구성.
   4. 메인 창을 직접 생성(`tauri.conf.json`은 `create: false`) — 부트스트랩을 초기화 스크립트로 넣어 페이지 스크립트보다 먼저 실행되게 함. Windows에서는 화면 크기에 맞춤.
   5. 명령줄 파일: 첫 파일은 메인 창, 나머지는 새 창. 그 뒤 비정상 종료로 남은 미저장 내용 복구 제안.
   6. 명령줄 파일이 없으면: 시작 동작이 `lastSession`이면 지난 세션 복원, 아니면(기본) 미저장 내용 복구 제안.
   7. 확장 업데이트 확인 스레드(업데이트 동작: Never / Quiet(기본) / Notify / Automatic).
   8. 앱 업데이트 확인(릴리스 빌드, `general.checkForUpdates`가 켜져 있을 때 5초 뒤 한 번, §8.1).
2. **부트스트랩 스크립트**(각 창의 초기화 스크립트): `window.config`(EditorConfig), `window.config.runtimeInfo`, `window.MarkEdit.userSettings`, `<html data-appearance data-reduce-transparency>`, 브리지 폴리필.
3. **에디터 로드**: CoreEditor가 `core.notifyWindowDidLoad`를 호출 → 호스트는 `{ text, restoreText, extensions }`를 반환 → `hostDocument.ts`가 문서를 넣고, 복구 텍스트를 편집으로 적용(되돌리기 가능, 수정됨 표시)하고, 확장을 하나씩 실행(한 확장의 오류가 문서 로드를 막지 않음).
4. **에디터·앱 UI 초기화**: `index.ts`가 번들 폰트(`@font-face`)를 등록하고 편집기를 만든 뒤, `initChromeUI()`가 `window.chromeUI`를 만들고 저장된 파서·다이어그램 설정·프리뷰 스타일을 복원하며 `<html data-platform>`을 설정한다.

---

## 5. UI 구성

| 영역 | 구현 |
| --- | --- |
| 메뉴 바 | 네이티브(muda): SuperMark, File, Edit, Format, View, Go, Extensions, Window, Help. 메뉴 동작은 대부분 포커스된 창에 웹 스크립트로 전달. 확장이 추가한 항목 포함, 상태 변경 시 메뉴 전체 재구성 |
| 검색/바꾸기, 목차, 통계, 줄 이동 | WebView 안의 패널·팝오버(`chrome/`). 같은 컨텍스트에서 `webModules.search` 등을 직접 호출 |
| 설정, 확장 관리자, 버전 기록 | WebView 안의 모달 대화상자 (`DES-003`) |
| 프리뷰 | 분할/마크다운 보기 창, 형식 모듈별 프리뷰 (`DES-002`) |
| 경고·저장 대화상자 | 네이티브(`rfd`) |

---

## 6. 보안 경계

| 항목 | 설계 |
| --- | --- |
| 프리뷰의 원시 HTML | 공통 엔진은 이스케이프, Markdown Super Set은 태그 필터. 위험 URL(`javascript:` 등) 차단 |
| 확장 렌더러 문서 | 스크립트 불가 샌드박스 프레임 |
| 링크 | 페이지 이동 금지. `links.rs`: http(s)·mailto만 시스템으로, 마크다운 문서는 앱에서, 그 밖의 로컬 파일은 탐색기에서 표시만(실행 파일을 실행하지 않음), 그 외 무시 |
| 확장 설치 | https만, sha256 고정·검증, 확장 홈페이지는 http(s)만 |
| 버전 기록 ID | `v-<ms>-<seq>` 형식만 허용(경로 탈출 방지), 선택한 ID만 삭제 |
| 다이어그램 서버 출력 | `<img>`로만 표시 |
| 앱 업데이트 | https로 받은 파일의 minisign 서명을 앱에 내장된 공개 키(`tauri.conf.json` `plugins.updater.pubkey`)로 검증한 뒤에만 설치. 개인 키는 GitHub Secrets에만 둠 |
| 비밀 저장소 | **미흡**: `secrets.json` 평문 (Credential Manager 연동 예정) |

---

## 7. 데이터 저장 위치 (`<config_dir>/MarkEdit/`)

Windows `%APPDATA%\MarkEdit`, macOS `~/Library/Application Support/MarkEdit`. 앱 이름이 바뀌었어도 기존 데이터를 그대로 쓰기 위해 폴더 이름과 앱 식별자(`app.markedit.rust`)는 유지한다.

| 경로 | 내용 |
| --- | --- |
| `settings.json` | 사용자 설정 (`DES-003`) |
| `recent.json` | 최근 문서 (최대 15개) |
| `last-session.json` | 열려 있던 창 목록 |
| `Backups/` | 미저장 내용 백업(`<label>.md` + `.json`), 복구 거절 시 `Backups/Discarded/<시각>/` |
| `Versions/<경로 해시>/` | 저장할 때마다 기록하는 버전 |
| `extensions.json`, `scripts/`, `styles/`, `cache/` | 확장 설정, 확장 스크립트·스타일, 레지스트리 캐시 |
| `secrets.json` | 확장용 비밀 값 |
| `logs/markedit.log` | 진단 로그 (1MB에서 `.log.1`로 교체) |

---

## 8. 빌드와 배포

| 단계 | 내용 |
| --- | --- |
| 에디터 | `packages/core-editor`에서 `yarn build` = lint + typecheck + vite. `vite-plugin-singlefile`로 `dist/index.html` 하나에 번들하고, 큰 자산은 옆에 복사: `dist/vendor/mermaid.min.js`, `dist/fonts/`(D2Coding, Pretendard, 라이선스) |
| 호스트 | `cargo build --release --features tauri/custom-protocol` → `target/release/supermark` (`frontendDist`의 `dist/`를 실행 파일에 포함) |
| 설치 파일 | 릴리스 워크플로의 `tauri build`. 실행 파일 이름 `SuperMark.exe`(`mainBinaryName`), NSIS 사용자 설치, WebView2 부트스트래퍼 |
| 단일 인스턴스 | `tauri-plugin-single-instance` |

### 8.1 릴리스와 앱 자체 업데이트

소스 저장소(`firegong/SuperMark`)는 비공개이고, 설치 파일과 업데이트 파일은 공개 저장소 **`firegong/SuperMark-releases`**의 릴리스로 올린다. 앱은 인증 없이 그 릴리스를 받는다.

| 항목 | 내용 |
| --- | --- |
| 릴리스 워크플로 | `.github/workflows/release.yml`: `v*` 태그 또는 수동 실행 → Windows·macOS에서 `tauri-action`이 빌드하고, `owner`/`repo`로 공개 저장소에 **초안** 릴리스를 만든다(태그는 그 저장소의 `main`에). 두 작업이 끝나면 사람이 초안을 게시 |
| 업데이트 파일 | `bundle.createUpdaterArtifacts: true` → Windows NSIS 설치 파일, macOS `.app.tar.gz`와 각각의 `.sig`. `includeUpdaterJson: true` → 두 플랫폼 항목을 담은 `latest.json` |
| 확인 주소 | `https://github.com/firegong/SuperMark-releases/releases/latest/download/latest.json` (초안·사전 릴리스는 제외됨) |
| 비밀 값 | `RELEASES_TOKEN`(공개 저장소 Contents 읽기·쓰기 토큰), `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — 소스 저장소의 Actions secrets |
| 앱 동작 (`updates.rs`) | 메뉴 *Check for Updates…*: 결과를 항상 알림. 시작 시 확인: 새 버전이 있을 때만, 건너뛴 버전(`general.skippedUpdateVersion`)은 제외. 대화상자 예=설치, 아니요=나중에, 취소=이 버전 건너뛰기. 미저장 문서가 있으면 저장을 먼저 요청. Windows는 설치 프로그램(passive)이 이어받고, macOS는 앱을 교체한 뒤 재시작 |
| 버전 | 릴리스마다 `tauri.conf.json`과 `Cargo.toml`의 `version`을 올린다. 앱은 실행 중인 버전보다 높은 버전만 제안 |
| 절차 | `docs/06-release/01-release-procedure.md` (최초 설정, 릴리스, 게시, 문제 해결) |

---

## 9. 코드 생성 (`ts-gyb`)

`packages/core-editor/src/@codegen/config.json`은 **Swift 대상만** 렌더링한다(원본 MarkEdit의 MarkEditCore/MarkEditKit 경로). Rust 쪽 `src-tauri/src/bridge/generated/mod.rs`는 **손으로 작성**되어 있다. TypeScript 브리지 정의와 Rust 구현이 어긋나지 않도록 Rust 대상(템플릿 `rust-*.mustache`)을 추가하는 것이 향후 과제다(`ARCH-002` §5).
