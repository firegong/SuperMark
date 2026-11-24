# SuperMark

**SuperMark**는 macOS용 오픈소스 경량 마크다운 에디터 **[MarkEdit](https://github.com/MarkEdit-app/MarkEdit)** 를 기반으로, **Tauri v2 (Rust + Microsoft Edge WebView2)** 를 사용해 macOS와 Windows에서 동작하도록 포팅·확장한 마크다운 에디터입니다.

SuperMark는 **Markdown Super Set Format** — MultiMarkdown 6, Pandoc, markdown-it, Obsidian의 장점을 모은 통합 마크다운 방언 — 을 시험하고 선보이기 위해 만들어졌습니다. 전체 사양은 [Markdown Super Set Format 저장소](https://github.com/firegong/Markdown-Super-Set-Format)를 참조하세요.

## 핵심 특징 (Core Highlights)

- **경량 네이티브 셸**: Electron 대신 macOS `WKWebView` / Windows `WebView2`와 Rust(`Tauri v2`) 네이티브 호스트를 결합했습니다.
- **검증된 에디터 엔진 (`CoreEditor`)**: CodeMirror 6 + Lezer 기반의 GitHub Flavored Markdown 에디터 코어 및 `markedit-api` 확장 런타임을 그대로 구동합니다.
- **크로스플랫폼 Fluent Chrome UI**:
  - 상단 검색 및 바꾸기 바 (`Cmd/Ctrl+F`, `Cmd/Ctrl+H` — 정규식, 대소문자, 단어 단위, 매치 카운터)
  - 실시간 필터링 목차(TOC) 팝오버 (`Cmd/Ctrl+Shift+O`) 및 문서/선택 영역 통계(CJK 단어 수 지원) 팝오버 (`Cmd/Ctrl+Shift+I`)
  - 줄 번호 이동 (`Cmd/Ctrl+G`), 확장 플러그인용 프롬프트 모달(`showTextBox`) 및 플로팅 컨텍스트 메뉴(`showContextMenu`)
- **폴더 사이드바**: 폴더를 열면 하위 폴더까지 재귀적으로 탐색하여 마크다운 파일만 트리로 표시하고, 현재 문서의 헤딩 아웃라인을 탭으로 전환해 보여줍니다.
- **완전한 문서 수명주기 (`DocumentManager`)**:
  - 다중 인코딩 자동 감지·보존 (`UTF-8`, `UTF-8 BOM`, `UTF-16LE`, `UTF-16BE`, `EUC-KR/CP949`) 및 줄바꿈(`CRLF`/`LF`) 유지
  - `.textbundle` 디렉터리 및 `.textpack` 압축 아카이브 직접 열기/저장
  - 외부 파일 변경 실시간 감시(`notify`), 자동 저장, 미저장 자동 백업(Hot Exit), 로컬 파일 버전 히스토리(`Versions/`), 닫기 전 저장 확인 가드
- **로컬 이미지 렌더링**: 마크다운 미리보기에서 문서 폴더 기준 상대 경로 이미지를 렌더링합니다.
- **확장 생태계 호환 (`%APPDATA%/SuperMark/` 또는 `~/Library/Application Support/SuperMark/`)**:
  - `scripts/*.js` 및 `styles/*.css` 자동 주입 (`__prepareScriptContexts__` / `__runScriptWithContext__`)
  - `MarkEdit.secretStorage` 영속 저장소 및 시스템 클립보드(`arboard`) 연동
- **확장 프로그램 시스템 (Extensions, 업스트림 호환)**:
  - `Extensions` 메뉴: 확장 탐색(GitHub 레지스트리), 업데이트 확인, URL에서 설치, 확장 폴더 열기, 확장 다시 로드
  - `extensions.json` 설정 (`$schema`, `registry.url`, `registry.updateBehavior`: quiet/notify/automatic/never)
  - 레지스트리 인덱스 조건부 GET(`If-None-Match` ETag, 1시간 TTL), sha256 무결성 검증, `minAppVersion` 호환성 검사
  - `Notify`: 하루 1회 업데이트 알림 대화상자 / `Automatic`: 자동 설치 후 에디터 재주입(reload)

---

## 저장소 폴더 구조

```text
SuperMark/
├── README.md                                 # 프로젝트 개요 및 빌드 안내 (영어)
├── README.ko.md                              # 한국어 버전
├── LICENSE                                    # MIT License
├── .github/workflows/                        # CI 빌드 및 테스트 파이프라인
├── docs/                                     # 소프트웨어 공학 개발 산출물 (SDLC Artifacts)
├── packages/
│   └── core-editor/                          # MarkEdit CoreEditor (CodeMirror 6 + Fluent Chrome UI)
├── src-tauri/                                # 네이티브 호스트 (Rust / Tauri v2)
└── scripts/                                  # 코드 생성 및 빌드 자동화 스크립트
```

---

## 빌드 및 테스트 방법 (Build & Verification)

### 1. `CoreEditor` 프론트엔드 번들 빌드 및 테스트
```bash
cd packages/core-editor
yarn install
yarn test        # Jest 스위트 실행
yarn build       # ESLint + TypeScript 검사 + 단일 HTML 번들(dist/index.html) 생성
```

### 2. Tauri v2 (Rust) 네이티브 호스트 테스트 및 빌드
```bash
cd src-tauri
cargo test       # 인코딩, TextBundle/TextPack, 브리지, 버전 히스토리, 확장 로더 단위 테스트
cargo build --release
```

---

## 라이선스 및 출처

- 원작 프로젝트: [MarkEdit-app/MarkEdit](https://github.com/MarkEdit-app/MarkEdit) (MIT License, Copyright (c) cyanzhong and contributors)
- SuperMark는 MarkEdit을 기반으로 Tauri v2로 포팅·확장한 프로젝트입니다.
- See `LICENSE` for the full license and third-party notices.