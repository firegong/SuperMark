# Windows 포팅 요구사항 명세서 (SRS)

- **문서 번호**: `REQ-002`
- **작성일**: 2026-11-08
- **상태**: Draft v1.0

---

## 1. 목적 및 범위

본 문서는 macOS용 `MarkEdit`를 Windows 10/11 환경으로 포팅하기 위한 기능 요구사항(Functional Requirements), 비기능 요구사항(Non-Functional Requirements), 그리고 플랫폼 차이에 따른 대체/제외 범위를 정의합니다.

---

## 2. 기능 요구사항 (Functional Requirements)

### FR-01: 마크다운 에디터 코어 (`CoreEditor`)
- **FR-01.1 (GFM 문법 지원)**: GitHub Flavored Markdown(GFM) 명세를 엄격히 준수하며 코드 블록, 테이블, 체크리스트, 각주, 수학 수식(Math), YAML Front Matter 하이라이팅을 지원해야 한다.
- **FR-01.2 (고급 편집 기능)**: 멀티 커서(Multi-caret), 코드 및 헤더 섹션 폴딩(Folding), 스마트 따옴표, 자동 괄호 쌍 완성, 줄 바꿈(LF/CRLF) 감지 및 전환을 지원해야 한다.
- **FR-01.3 (표시 모드)**: 줄 번호 표시, 현재 줄 강조, 보이지 않는 문자(공백/줄바꿈) 표시 제어, 타자기 모드(Typewriter Mode), 포커스 모드(Focus Mode), 읽기 전용 모드를 지원해야 한다.

### FR-02: 문서 및 파일 수명주기 관리 (`NSDocument` 대체)
- **FR-02.1 (파일 I/O)**: `.md`, `.markdown`, `.txt`, `.textbundle` 파일 열기, 저장, 다른 이름으로 저장을 지원해야 한다.
- **FR-02.2 (더티 상태 및 종료 보호)**: 편집 중인 문서의 수정 여부(`isDirty`)를 창 제목 표시줄(`*` 또는 상태 표시)에 반영하고, 저장하지 않고 닫을 때 저장 확인 대화상자를 표시해야 한다.
- **FR-02.3 (외부 변경 감지)**: 열려 있는 파일이 외부 프로그램에서 수정된 경우 이를 감지하여 자동 리로드(깨끗한 상태일 때) 또는 충돌 알림(수정 중일 때)을 제공해야 한다.
- **FR-02.4 (자동 백업 / Hot Exit)**: 예기치 않은 종료에 대비해 미저장 문서를 로컬 앱 데이터 영역(`%APPDATA%/MarkEdit/Backups`)에 주기적으로 스냅샷 저장하고 재실행 시 복구해야 한다.
- **FR-02.5 (최근 문서 목록)**: 최근에 연 파일 목록(`recentDocumentPaths`)을 관리하고 메뉴에서 즉시 다시 열 수 있어야 한다.

### FR-03: Windows 네이티브 셸 및 UI
- **FR-03.1 (네이티브 메뉴바 및 단축키)**: 파일, 편집, 서식( 헤더/볼드/이탤릭/리스트/링크/테이블 삽입), 보기, 창, 도움말 메뉴를 Windows 표준 단축키(`Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+F`, `Ctrl+H`, `Ctrl+B`, `Ctrl+I` 등)로 제공해야 한다.
- **FR-03.2 (검색 및 바꾸기 패널)**: 대소문자 구분, 단어 단위, 정규식(Regex), 선택 영역 내 검색 및 일괄 치환 기능을 갖춘 상단 검색 바를 제공해야 한다.
- **FR-03.3 (목차 및 통계 패널)**: 문서 내 헤딩 구조를 추출한 목차(TOC) 이동 메뉴와 실시간 글자/단어/문단/읽기 시간 통계 뷰를 제공해야 한다.
- **FR-03.4 (설정 관리)**: `%APPDATA%/MarkEdit/settings.json` 파일을 통해 에디터 테마, 글꼴, 들여쓰기, 줄 간격 등을 영속화하고 실시간 반영해야 한다.

### FR-04: 확장 시스템 (`MarkEdit-api` 호환)
- **FR-04.1 (유저 스크립트 및 CSS 로더)**: `%APPDATA%/MarkEdit/scripts/` 및 `styles/` 폴더에서 사용자 정의 `.js`, `.css` 파일을 로드하여 `MarkEdit` 전역 API(`MarkEdit.addExtension`, `MarkEdit.editorAPI` 등)를 실행해야 한다.
- **FR-04.2 (네이티브 확장 API 제공)**: 확장에서 요청하는 컨텍스트 메뉴, 알림창(`showAlert`), 입력창(`showTextBox`), 파일 열기/저장 패널, 클립보드 접근 API를 Windows 네이티브 다이얼로그와 연결해야 한다.

---

## 3. 플랫폼별 기능 매핑 및 대체/제외 범위

| macOS 원본 기능 | Windows 포팅 처리 방침 | 우선순위 |
| :--- | :--- | :---: |
| `WKWebView` + `WKScriptMessageHandler` | Microsoft Edge `WebView2` + Tauri v2 IPC 어댑터 | **P0 (필수)** |
| `NSDocument` 파일 수명주기 | Rust 문서 매니저 (`notify` 파일 워처 + 더티 상태 추적 + 자동 스냅샷) | **P0 (필수)** |
| `AppKit` 메인 메뉴 / 컨텍스트 메뉴 | Tauri `menu` (`muda`) 네이티브 Win32 메뉴 및 팝업 메뉴 | **P0 (필수)** |
| `Keychain` (`secretStorage`) | Windows Credential Manager (`keyring` 크레이트 연동) | **P1 (권장)** |
| `.textbundle` 지원 (`TextBundle`) | Rust `zip` / 디렉터리 번들 리더·라이터 구현 | **P1 (권장)** |
| `NSSpellChecker` (`completion`/`tokenizer`) | Windows `ISpellChecker` COM API 또는 내장 JS 단어 토크나이저 | **P2 (선택)** |
| `FileVersion` (macOS Time Machine/GSD) | 로컬 스냅샷 히스토리 또는 Git 연동으로 대체 | **P2 (선택)** |
| `QuickLookMac` (Finder 미리보기) | 본 앱에서 제외 (추후 PowerToys Peek / Explorer Preview Handler 별도 검토) | **제외 (Out of scope)** |
| `FoundationModels` / `WritingTools` | macOS 26 전용 Apple Intelligence API이므로 기본 비활성화(No-op 스텁) | **제외 (No-op 스텁)** |

---

## 4. 비기능 요구사항 (Non-Functional Requirements)

- **NFR-01 (설치 용량)**: 단일 설치 파일(`.msi` 또는 `.exe` NSIS 설치본) 크기는 **10 MB 이하 (목표 4~6 MB)** 여야 한다.
- **NFR-02 (초기 구동 속도)**: 콜드 스타트 기준 창 표시 및 편집 가능 상태 도달 시간이 **300ms 이내**여야 한다.
- **NFR-03 (대용량 파일 성능)**: 10 MB (약 10만~100만 줄) 마크다운 파일을 열었을 때 UI 프리징 없이 스크롤 및 타이핑이 가능해야 한다.
- **NFR-04 (업스트림 추적성)**: `CoreEditor` 디렉터리는 원본 `MarkEdit-app/MarkEdit`의 변경 사항을 최소한의 충돌로 병합(Merge/Rebase)할 수 있도록 수정 범위를 브리지 어댑터와 플랫폼 헬퍼로 국한해야 한다.
