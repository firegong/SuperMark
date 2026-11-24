# 문서 수명주기(`NSDocument` 대체) 및 멀티 윈도우 상세 설계서

- **문서 번호**: `DES-001`
- **작성일**: 2026-11-08 (최초), 2026-11-21 (현재 구현 기준으로 개정)
- **상태**: v2.0
- **관련 문서**: `ARCH-001` 시스템 아키텍처, `ARCH-002` 브리지 명세

---

## 1. 배경

macOS MarkEdit는 `NSDocument`/`NSDocumentController`로 다중 창, 수정 상태, 자동 저장, 인코딩을 처리한다. Windows에는 같은 프레임워크가 없으므로 Rust의 **`DocumentManager`**(`src-tauri/src/document/mod.rs`)가 이를 대신한다. 창 하나가 문서 하나이며, 창 레이블(`main`, `doc-2`, `doc-3` …)로 세션을 구분한다.

---

## 2. 데이터 구조

```rust
pub struct DocumentManager {
    sessions: Mutex<HashMap<String, DocumentSession>>, // 창 레이블 → 세션
    recent_files: …,                                   // recent.json (최대 15)
    user_menu_items: …,                                // 확장이 추가한 메뉴 항목
    app_data_dir: PathBuf,                             // <config_dir>/MarkEdit
    versions: VersionManager,                          // Versions/
    extensions: ExtensionManager,
    secrets: SecretStorageManager,
}

pub struct DocumentSession {
    pub window_label: String,
    pub file_path: Option<PathBuf>,        // 새 문서는 None
    pub bom: BomKind,                      // None / UTF-8 / UTF-16LE / UTF-16BE
    pub encoding_name: String,             // 기본 "UTF-8"
    pub line_endings: LineEndings,         // LF / CRLF / CR (새 문서 기본 CRLF)
    pub is_dirty: bool,
    pub content_cache: String,             // 마지막으로 읽거나 저장한 내용
    pub last_modified_secs: Option<u64>,
    pub pending_restore_text: Option<String>, // 복구할 미저장 내용 (한 번만 전달)
}
```

---

## 3. 시나리오

### 3.1 문서 열기

1. 진입점: 메뉴(Ctrl+O, 최근 문서), 탐색기 더블클릭(명령줄 인자, 실행 중이면 단일 인스턴스로 전달), 확장의 `MarkEdit.openDocument`, 프리뷰·에디터의 문서 링크 — 모두 `open_document_path`(`menu/mod.rs`)를 거친다.
2. **이미 열린 파일**이면(경로 정규화, Windows는 대소문자 무시) 그 창을 앞으로 가져오고 끝.
3. 파일이 없으면 경고 대화상자.
4. 포커스된 창이 **손대지 않은 빈 문서**(수정 없음, 경로 없음, 내용 없음)면 그 창에 읽고, 아니면 새 창(`create_editor_window`, 레이블 `doc-N`)을 만든다.
5. 읽기(`load_from_path`): BOM(UTF-8/16LE/16BE) → 유효한 UTF-8 → `chardetng` 추정 + `encoding_rs` 디코딩. 줄바꿈을 감지해 기록하고 편집기에는 `\n`으로 넘긴다. File → Reopen with Encoding으로 인코딩을 지정해 다시 읽을 수 있다.
6. 편집기는 `notifyWindowDidLoad` 응답이나 `document_content` 명령으로 내용을 받는다.
7. TextBundle: `.textbundle` 폴더(`text.md`/`text.markdown`/`text.txt`, `assets/`·`info.json` 보존)와 `.textpack`(zip)을 지원한다.

### 3.2 편집과 수정 상태

1. 입력 시 CoreEditor가 `core.notifyViewDidUpdate({ isDirty, … })`를 보내면 `is_dirty`를 갱신하고 창 제목을 바꾼다: `README.md — SuperMark` / `● README.md — SuperMark`.
2. 입력이 멈추면 `core.notifyEditorDidBecomeIdle`이 오고, 수정된 상태면 편집기가 `save_idle_backup`으로 현재 내용을 보내 `Backups/<label>.md`와 메타데이터 `<label>.json`(`window_label`, `original_path`, `timestamp_secs`)에 기록한다.

### 3.3 저장 (Save / Save As)

1. 경로가 없거나 Save As면 창에 붙은 저장 대화상자(기본 이름 `Untitled.<새 파일 확장자>`).
2. 설정에 따라 줄 끝 공백 제거, 마지막 줄바꿈 추가.
3. 원래 인코딩·BOM·줄바꿈으로 인코딩하여 **원자적 쓰기**(`*.markedit.tmp`에 쓴 뒤 이름 변경).
4. 저장 후: 버전 기록, 최근 문서 갱신, 백업 삭제, 메뉴·제목 갱신, 세션 목록 저장. 저장하는 동안 편집기 내용이 바뀌지 않았을 때만 `history.markContentClean()`.

### 3.4 버전 기록

- 저장할 때마다 `Versions/<경로 해시>/v-<ms>-<seq>.md`로 기록한다.
- File → Version History 대화상자(`versions_*` 명령)와 확장 API(`getFileVersions` 등)에서 보기·복원·삭제. 복원은 파일 형식을 유지한 채 저장한다.
- ID는 `v-<ms>-<seq>` 형식만 허용하고, 삭제는 지정한 ID만 한다. 오래된 버전의 정리(보존 기한)는 아직 없다.

### 3.5 외부 파일 변경 감지

- `document/watcher.rs`에 `notify` 기반 `ExternalFileWatcher`가 있으나 **아직 연결되지 않았다**. 외부 변경 시 자동 반영(수정 없음)·충돌 안내와 비교·병합(수정 있음)은 향후 과제다.

### 3.6 창 닫기와 종료

- `CloseRequested`: 수정되지 않았으면 닫는다. 수정되었으면 저장/저장 안 함/취소 대화상자 — 저장은 저장 후 닫기, 저장 안 함은 수정 상태와 백업을 지우고 닫기, 취소는 유지.
- 앱 종료(메뉴 Quit/Exit)는 창을 하나씩 닫으므로 창마다 확인한다.
- 창이 없어지면(`Destroyed`) 세션 목록을 저장한다.

### 3.7 다음 실행: 세션 복원과 충돌 복구

| 상황 | 동작 |
| --- | --- |
| 시작 동작 `lastSession` | `last-session.json`의 창들을 다시 열고, 백업이 있으면 미저장 내용까지 복원 |
| 기본(`newDocument`) 또는 파일로 시작 | 남아 있는 백업 = 비정상 종료로 남은 미저장 내용. "복원할까요?" 대화상자: 예 → 문서마다 창으로 복원(파일로 시작했으면 새 창), 아니요 → `Backups/Discarded/<시각>/`로 옮겨 보관(삭제하지 않음) |

- 복원된 내용은 `pending_restore_text`로 한 번만 편집기에 전달되어 **편집으로 적용**된다(수정됨 표시, 되돌리기로 디스크 내용 확인 가능).
- 백업은 새 창 레이블로 옮겨 이후 저장이 올바른 백업을 지우게 한다.

### 3.8 창 크기

새 창은 960×680(최소 420×300). Windows에서는 모니터 작업 영역의 60%×80%(800~1400 × 600~1000 논리 픽셀)로 열고 첫 창은 가운데에 둔다.
