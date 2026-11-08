# 문서 수명주기(`NSDocument` 대체) 및 멀티 윈도우 상세 설계서

- **문서 번호**: `DES-001`
- **작성일**: 2026-11-08
- **상태**: Draft v1.0

---

## 1. 배경 및 목적

macOS 버전의 MarkEdit는 Apple의 `NSDocument`와 `NSDocumentController`에 의존하여 다중 창 관리, 더티(Dirty) 상태 추적, 자동 저장(Autosave), 외부 파일 변경 감지, 인코딩 및 줄바꿈 처리를 수행합니다.
Windows(Tauri v2) 환경에서는 OS가 `NSDocument`와 동일한 고수준 프레임워크를 제공하지 않으므로, Rust 백엔드(`src-tauri`)에서 이를 대체하는 **`DocumentManager`** 상태 머신을 설계합니다.

---

## 2. 핵심 데이터 구조 (Rust `DocumentState`)

```rust
use std::path::PathBuf;
use std::time::SystemTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LineEndings {
    LF,
    CRLF,
    CR,
}

#[derive(Debug, Clone)]
pub struct DocumentSession {
    /// Tauri 창 고유 레이블 (예: "doc-1", "doc-2")
    pub window_label: String,
    /// 연결된 디스크 파일 경로 (새 문서인 경우 None)
    pub file_path: Option<PathBuf>,
    /// 디스크에서 마지막으로 읽거나 저장한 시점의 수정 시각
    pub last_modified_on_disk: Option<SystemTime>,
    /// 문자 인코딩 (기본 UTF-8, UTF-16LE/BE, EUC-KR 등 감지 지원)
    pub encoding: &'static encoding_rs::Encoding,
    /// 줄바꿈 방식 (Windows 기본 CRLF 또는 파일 원본 유지)
    pub line_endings: LineEndings,
    /// CoreEditor가 notifyViewDidUpdate로 보고한 수정 여부
    pub is_dirty: bool,
    /// 비정상 종료 복구용 임시 스냅샷 파일 경로
    pub backup_slot_path: PathBuf,
}
```

---

## 3. 주요 수명주기 시나리오별 상태 전이

### 3.1 문서 열기 (Open Document)
1. 사용자가 `Ctrl+O` 또는 탐색기에서 `.md` 파일을 더블클릭합니다.
2. 이미 열려 있는 `file_path`인지 검사하여, 열려 있다면 해당 Tauri 창을 포커스(`set_focus`)합니다.
3. 현재 활성 창이 **"제목 없음(Untitled)"이면서 `is_dirty == false`이고 내용이 비어 있는 경우**, 새 창을 만들지 않고 현재 창에 문서를 로드합니다(MarkEdit macOS 동작과 동일).
4. 바이트 스트림을 읽어 BOM 및 문자 인코딩(`chardetng` + `encoding_rs`)과 줄바꿈(`LF` vs `CRLF`)을 판별합니다.
5. `webModules.core.resetEditor({ text, documentChanged: false })` 및 `webModules.lineEndings.setLineEndings(...)`를 호출합니다.
6. 파일 시스템 워처(`notify` 크레이트)에 해당 경로를 등록합니다.

### 3.2 편집 및 더티(Dirty) 상태 동기화
1. 사용자가 타이핑하면 `CoreEditor`가 `nativeModules.core.notifyViewDidUpdate({ isDirty, selectedLineColumn, ... })`를 호출합니다.
2. `DocumentSession.is_dirty`가 변경되면 창 제목 표시줄을 즉시 갱신합니다:
   - 깨끗한 상태: `README.md — MarkEdit`
   - 수정된 상태: `● README.md — MarkEdit`
3. 사용자가 타이핑을 멈추면 약 1초 뒤 `notifyEditorDidBecomeIdle()`이 호출되며, 이때 `is_dirty == true`이면 백그라운드에서 `webModules.core.getEditorText()`를 가져와 `%APPDATA%/MarkEdit/Backups/<session_id>.md`에 비동기로 기록합니다.

### 3.3 문서 저장 (Save / Save As)
1. `Ctrl+S` 입력 시 `file_path`가 없으면 `Save As` 네이티브 파일 대화상자를 먼저 띄웁니다.
2. 설정(`insertFinalNewline`, `trimTrailingWhitespace`)에 따라 `webModules.format.formatContent(...)`를 먼저 수행합니다.
3. `webModules.core.getEditorText()`와 `webModules.lineEndings.getLineEndings()`를 조회하여 지정된 줄바꿈 및 인코딩으로 원자적 쓰기(Atomic Write: 임시 파일 기록 후 Rename)를 수행합니다.
4. 저장 성공 후 `webModules.history.markContentClean()`을 호출하여 에디터의 `isDirty` 플래그를 해제하고 백업 슬롯 파일을 삭제합니다.

### 3.4 외부 파일 변경 감지 (External File Modification)
- 디스크 파일이 외부(예: `git checkout`, 다른 에디터)에서 변경되었을 때:
  - **`is_dirty == false`인 경우**: 조용히 파일을 다시 읽어 `resetEditor`로 최신 본문을 반영하고 커서 위치를 보존합니다.
  - **`is_dirty == true`인 경우**: 사용자에게 "파일이 외부에서 변경되었습니다. 다시 불러오시겠습니까, 아니면 현재 편집 내용을 유지하시겠습니까?" 알림창을 표시합니다.

### 3.5 창 닫기 및 앱 종료 보호 (Close Guard)
- Tauri의 `WindowEvent::CloseRequested` 이벤트를 가로채어(`api.prevent_close()`):
  - `is_dirty == false`: 즉시 창을 닫고 세션을 정리합니다.
  - `is_dirty == true`: Windows 네이티브 3버튼 대화상자(**저장(Save)** / **저장 안 함(Don't Save)** / **취소(Cancel)**)를 띄워 데이터 유실을 방지합니다.
