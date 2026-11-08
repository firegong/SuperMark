# 테스트 및 검증 계획서 (Test & Verification Plan)

- **문서 번호**: `TEST-001`
- **작성일**: 2026-11-08
- **상태**: Draft v1.0

---

## 1. 검증 계층 구조

### 1.1 `CoreEditor` 단위 테스트 (Jest + JSDOM)
- **실행 명령**: `cd packages/core-editor && yarn lint && yarn typecheck && yarn test`
- **검증 범위**:
  - 기존 MarkEdit의 31개 테스트 스위트(`basic`, `commands`, `codegen`, `search`, `toc`, `api` 등)가 Windows 호환 패치 후에도 100% 통과하는지 확인합니다.
  - WebView2 / Tauri 브리지 어댑터 모킹 테스트를 추가합니다.

### 1.2 브리지 코드 생성(`ts-gyb`) 정합성 검증
- **실행 명령**: `cd packages/core-editor && yarn codegen && cd ../../src-tauri && cargo check`
- **검증 범위**:
  - TypeScript 인터페이스(`bridge/native/*.ts`, `bridge/web/*.ts`, `config.ts`)에서 생성된 Rust 코드가 컴파일 경고/오류 없이 `serde` 직렬화·역직렬화를 통과하는지 확인합니다.

### 1.3 Rust 호스트 단위 테스트 (`cargo test`)
- **실행 명령**: `cd src-tauri && cargo test`
- **검증 범위**:
  - 파일 인코딩 감지(UTF-8, UTF-8 with BOM, UTF-16LE, EUC-KR/CP949) 및 줄바꿈(CRLF/LF) 보존 테스트
  - `DocumentSession` 상태 전이(Clean → Dirty → Save → Clean) 및 임시 백업 복구 로직 테스트
  - `settings.json` 파싱 및 기본값 폴백 테스트

### 1.4 Windows 통합 및 성능 검증 (E2E Checklist)
- **기능 체크리스트**:
  - [ ] 탐색기에서 `.md` 파일 더블클릭 시 300ms 이내에 본문이 렌더링되는가?
  - [ ] 한국어(한글) IME 조합 중 글자 깨짐, 커서 튐, 마지막 글자 중복 입력 없이 `notifyCompositionEnded`가 정상 동작하는가?
  - [ ] 수정 후 저장하지 않고 `Alt+F4` 또는 닫기(`X`) 클릭 시 저장 확인 대화상자가 나타나는가?
  - [ ] `Ctrl+F` / `Ctrl+H`로 검색 및 모두 바꾸기 실행 시 하이라이트와 매치 카운터가 즉시 갱신되는가?
  - [ ] 공식 MarkEdit 확장 스크립트(`markedit-preview`, `markedit-theming` 등)를 넣었을 때 오류 없이 로드되는가?
- **대용량 성능 테스트**:
  - [ ] 10 MB 크기의 마크다운 파일을 열었을 때 메모리 점유율이 150 MB 이하로 유지되고 60fps 스크롤이 가능한가?
