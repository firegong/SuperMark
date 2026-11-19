# SuperMarkdownEdit (formerly MarkEdit-Win)

macOS용 오픈소스 경량 마크다운 에디터인 **[MarkEdit](https://github.com/MarkEdit-app/MarkEdit)** 를 **Tauri v2 (Rust + Microsoft Edge WebView2)** 기반으로 Windows 환경에 포팅한 프로젝트입니다.

## 핵심 특징 (Core Highlights)

- **초경량 네이티브 셸 (~4~6 MB)**: Electron 대신 Windows 10/11 내장 `WebView2`와 Rust(`Tauri v2`) 네이티브 호스트를 결합했습니다.
- **검증된 에디터 엔진 (`CoreEditor`)**: CodeMirror 6 + Lezer 기반의 GitHub Flavored Markdown 에디터 코어 및 `markedit-api` 확장 런타임을 그대로 구동합니다.
- **Windows 11 Fluent Chrome UI**:
  - 상단 검색 및 바꾸기 바 (`Ctrl+F`, `Ctrl+H` — 정규식, 대소문자, 단어 단위, 매치 카운터)
  - 실시간 필터링 목차(TOC) 팝오버 (`Ctrl+Shift+O`) 및 문서/선택 영역 통계(CJK 단어 수 지원) 팝오버 (`Ctrl+Shift+I`)
  - 줄 번호 이동 (`Ctrl+G`), 확장 플러그인용 프롬프트 모달(`showTextBox`) 및 플로팅 컨텍스트 메뉴(`showContextMenu`)
- **완전한 문서 수명주기 (`DocumentManager`)**:
  - 다중 인코딩 자동 감지·보존 (`UTF-8`, `UTF-8 BOM`, `UTF-16LE`, `UTF-16BE`, `EUC-KR/CP949`) 및 줄바꿈(`CRLF`/`LF`) 유지
  - `.textbundle` 디렉터리 및 `.textpack` 압축 아카이브 직접 열기/저장
  - 외부 파일 변경 실시간 감시(`notify`), 미저장 자동 백업(Hot Exit), 로컬 파일 버전 히스토리(`Versions/`), 닫기 전 저장 확인 가드
- **확장 생태계 호환 (`%APPDATA%/MarkEdit/`)**:
  - `%APPDATA%/MarkEdit/scripts/*.js` 및 `styles/*.css` 자동 주입 (`__prepareScriptContexts__` / `__runScriptWithContext__`)
  - `MarkEdit.secretStorage` 영속 저장소 및 시스템 클립보드(`arboard`) 연동
- **확장 프로그램 시스템 (Extensions, 업스트림 호환)**:
  - `Extensions` 메뉴: 확장 탐색(GitHub 레지스트리), 업데이트 확인, URL에서 설치, 확장 폴더 열기, 확장 다시 로드
  - `extensions.json` 설정 (`$schema`, `registry.url`, `registry.updateBehavior`: quiet/notify/automatic/never)
  - 레지스트리 인덱스 조건부 GET(`If-None-Match` ETag, 1시간 TTL), sha256 무결성 검증, `minAppVersion` 호환성 검사
  - `Notify`: 하루 1회 업데이트 알림 대화상자 / `Automatic`: 자동 설치 후 에디터 재주입(reload)

---

## 저장소 폴더 구조

```text
MarkEdit-Win/
├── README.md                                 # 프로젝트 개요 및 빌드 안내
├── .github/workflows/ci-windows.yml          # Windows CI 빌드 및 테스트 파이프라인
├── docs/                                     # 소프트웨어 공학 개발 산출물 (SDLC Artifacts)
│   ├── 01-requirements/                      # 타당성 분석서 및 요구사항 명세서 (SRS)
│   ├── 02-architecture/                      # 시스템 아키텍처 및 Native(7종)↔Web(12종) RPC 명세
│   ├── 03-design/                            # NSDocument 대체 문서 수명주기 상세 설계서
│   ├── 04-roadmap/                           # Phase 1~3 구현 로드맵
│   └── 05-testing/                           # 테스트 및 검증 계획서
├── packages/
│   └── core-editor/                          # MarkEdit CoreEditor (CodeMirror 6 + Fluent Chrome UI)
├── src-tauri/                                # Windows 네이티브 호스트 (Rust / Tauri v2)
│   ├── src/bridge/                           # 양방향 브리지 디스패처, 공유 DTO, SecretStorage
│   ├── src/document/                         # 문서 세션, 인코딩, TextBundle/TextPack, 버전 히스토리, 파일 워처
│   ├── src/extensions/                       # 유저 스크립트(.js) 및 스타일(.css) 로더
│   ├── src/menu/                             # Windows 네이티브 메뉴바 및 단축키 라우터
│   └── src/settings/                         # EditorConfig 및 settings.json 매니저
└── scripts/                                  # 코드 생성 및 빌드 자동화 스크립트
```

---

## 빌드 및 테스트 방법 (Build & Verification)

### 1. `CoreEditor` 프론트엔드 번들 빌드 및 테스트
```bash
cd packages/core-editor
yarn install
yarn test        # 36+ Jest 스위트 실행
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
