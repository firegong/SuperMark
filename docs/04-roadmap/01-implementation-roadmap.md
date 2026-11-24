# 단계별 구현 로드맵 (Implementation Roadmap)

- **문서 번호**: `PLAN-001`
- **작성일**: 2026-11-08 (최초), 2026-11-21 (현재 구현 기준으로 개정)
- **상태**: v2.0 — Phase 1~4 완료(일부 항목 정정), Phase 5 이후 계획
- **관련 문서**: `REQ-002` 요구사항(구현 상태), `ARCH-002` 브리지 명세(메서드별 상태)

규모: **S** 하루 이내 · **M** 며칠 · **L** 일주일 이상

---

## 1. 전체 요약

| 단계 | 기간 | 목표 | 상태 |
| :--- | :--- | :--- | :---: |
| Phase 1 | 2026-11-08 | 코어 이식과 PoC | 완료 |
| Phase 2 | 2026-11-08 | 네이티브 셸과 핵심 기능 | 완료 (2개 항목 정정 → Phase 5) |
| Phase 3 | 2026-11-08 | 확장 호환과 제품화 | 완료 (1개 항목 부분 완료) |
| Phase 4 | 2026-11-09 ~ 11-21 | 프리뷰·파서, 테마·설정, Windows 품질, 강건성, 리브랜딩 | 완료 |
| Phase 5 | 다음 | 데이터 신뢰성, Windows 실기기 검증, 보안 마무리 | 계획 (P0) |
| Phase 6 | 그다음 | 확장 API·출력·편의 기능 완성 | 계획 (P1) |
| Phase 7 | 이후 | Markdown Super Set 고급 기능, 단어 제안, 성능 | 계획 (P2) |

---

## 2. 완료된 단계

### Phase 1: 코어 이식과 PoC
- [x] **M1.1**: 업스트림 `CoreEditor`를 `packages/core-editor`로 가져와 빌드·테스트 통과
- [x] **M1.2**: Tauri v2 / WebView2 IPC 브리지 폴리필
- [x] **M1.3**: macOS 전용 단축키·수정자(`Cmd` → `Ctrl`) 분기
- [x] **M1.4**: `src-tauri` 초기화, 로컬 `.md` 열기·편집·저장

### Phase 2: 네이티브 셸과 핵심 기능
- [ ] ~~**M2.1**: ts-gyb Rust 템플릿과 공유 DTO~~ → **정정: 미완료**. 코드젠은 Swift만 렌더링하고 Rust 브리지는 손으로 작성됨 → Phase 6 `M6.6`
- [x] **M2.2**: 네이티브 메뉴 바와 단축키 (muda)
- [x] **M2.3**: `DocumentManager` — 인코딩 감지, 줄바꿈 보존, 수정 표시, 닫기 전 저장 확인. ~~외부 파일 변경 감시~~ → **정정: 미연결** → Phase 5 `M5.1`
- [x] **M2.4**: 검색/바꾸기 바, 목차, 통계
- [x] **M2.5**: `settings.json`과 실시간 설정 반영

### Phase 3: 확장 호환과 제품화
- [x] **M3.1**: `scripts/`, `styles/` 로더
- [~] **M3.2**: 확장용 네이티브 API → **정정: 부분 완료**. 열기/저장 패널·종료/재시작 없음, 입력창은 입력 전에 반환, 비밀 저장소는 평문 → `M5.3`, `M6.3`
- [x] **M3.3**: 자동 백업, 다중 창, `.textbundle`/`.textpack`
- [x] **M3.4**: 파일 연결, 명령줄 열기, NSIS 설치, GitHub Actions 빌드

### Phase 4: 프리뷰, 테마, Windows 품질 (2026-11-09 ~ 11-21)
- [x] **M4.1 앱 UI와 확장 관리자**: 설정·버전 기록·확장 관리자(탐색/설치/업데이트, sha256 검증, 업데이트 동작) 대화상자, 플랫폼별 창 버튼
- [x] **M4.2 프리뷰**: 분할/마크다운 보기, 양방향 보간 스크롤 동기화(편집·선택 중 정지), 체크박스, 코드 복사, 안전한 링크 처리
- [x] **M4.3 파서**: CommonMark, GFM, Extended, Markdown Super Set, micromark(mdast 경유), gsync Markdown(`docs/reference/GSYNC-MARKDOWN-SYNTAX.md`), markdown-it — 형식마다 모듈(폴더) 하나가 파서와 프리뷰를 함께 갖는 구조(`formats/`), 공유 프리뷰·엔진, 프리뷰 마크업 약속 도우미와 파서 계약 테스트 (`DES-002`)
- [x] **M4.4 렌더러 플러그인**: Mermaid(번들)·PlantUML·D2·Graphviz(로컬)·Kroki 서버, LaTeX → MathML, 약 60개 언어 코드 강조(에디터·프리뷰 공통, 테마 색)
- [x] **M4.5 테마·설정**: 테마 드롭다운(색상 견본), 16개 테마별 프리뷰 기본 스타일과 사용자 스타일, 테마 확장 선택, 설정 마이그레이션 (`DES-003`)
- [x] **M4.6 Windows 품질**: 기본 불투명, 한글 글꼴(Pretendard·D2Coding 번들), 화면 맞춤 창 크기, Windows 스크롤바
- [x] **M4.7 신뢰성**: 기본 설정에서도 충돌 복구, 단일 인스턴스, 열린 파일 창 포커스, 버전 선택 삭제·ID 검증
- [x] **M4.8 강건성**: 깨진·적대적·무작위 입력 테스트, 중첩 한도, 선형 시간 문단, 손상된 설정 허용
- [x] **M4.9 리브랜딩**: 앱 SuperMark, 문법 Markdown Super Set, 실행 파일 `SuperMark.exe`, 저장소 `firegong/SuperMark`
- [x] **M4.10 앱 자체 업데이트**: `tauri-plugin-updater`, 공개 릴리스 저장소 `firegong/SuperMark-releases`, 서명된 업데이트 파일과 `latest.json`, 메뉴·시작 시 확인, 버전 건너뛰기 (`ARCH-001` §8.1, 릴리스 절차 `docs/06-release/01-release-procedure.md`)

---

## 3. 남은 작업

### Phase 5 (P0): 데이터 신뢰성과 출시 준비

| ID | 작업 | 근거 | 규모 |
| --- | --- | --- | :---: |
| M5.1 | 외부 파일 변경 감지: 수정 없으면 다시 읽기(커서 유지), 수정 중이면 알림과 비교·병합(공통 조상 기준 3방향, 충돌 덩어리별 선택), 삭제·이름 변경 알림, 자기 저장 무시 | FR-02.3 | L |
| M5.2 | Windows 실기기 검증: 글꼴 렌더링, 불투명 패널, 창 크기, 단일 인스턴스, 파일 연결, `SuperMark.exe` 설치·업데이트(기존 설치 위 덮어쓰기) | FR-07, M4.9 | S |
| M5.3 | 비밀 저장소를 Windows Credential Manager(`keyring` 또는 DPAPI)로, 기존 `secrets.json` 이전 | FR-04.5 | M |
| M5.4 | 설치 파일 크기 측정과 NFR-01 목표 재설정(예: Mermaid 지연 다운로드, 폰트 부분 집합 검토) | NFR-01 | S |
| M5.5 | 업데이트 서명 키·토큰을 Secrets에 등록하고 공개 키를 `tauri.conf.json`에 넣은 뒤, 두 버전을 연속 릴리스해 Windows·macOS에서 실제 업데이트 확인 | FR-03.7 | S |

### Phase 6 (P1): 기능 완성

| ID | 작업 | 근거 | 규모 |
| --- | --- | --- | :---: |
| M6.1 | 상태 표시줄(줄/열, 선택 글자 수, 인코딩, 줄바꿈) | FR-03.5 | M |
| M6.2 | PDF 내보내기(WebView2 `PrintToPdf`), 인쇄 옵션. §22 페이지 나누기·§24 출력 형식 조건 블록 적용 | FR-03.6 | M |
| M6.3 | 확장 API 완성: `showTextBox` 입력 대기, `showOpenPanel`/`showSavePanel`, `terminateApp`/`relaunchApp`/`playSystemBeep`, `saveDocument` 완료 후 반환, 확장 메뉴 `stateGetterID` | FR-04.2 | M |
| M6.4 | TextBundle UI: 폴더 선택 열기, 저장 대화상자 필터, 파일 연결 | FR-02.1 | S~M |
| M6.5 | 버전 기록 보존 기한·개수 제한과 정리 | FR-02.8 | S |
| M6.6 | ts-gyb Rust 대상 추가로 브리지 정의 자동 생성(형식 불일치 방지) | ARCH-002 §5 | M |
| M6.7 | `showAlert` 사용자 지정 버튼 이름(rfd `common-controls-v6`) | FR-04.2 | S |

### Phase 7 (P2): 고급 기능과 성능

| ID | 작업 | 근거 | 규모 |
| --- | --- | --- | :---: |
| M7.1 | Markdown Super Set 실행 청크(§13): 인터프리터 실행(시간 제한, 허용 설정), 결과 표시 — 코드 실행이므로 보안 설계 선행 | FR-05.3 | L |
| M7.2 | 청크 결과 캐시 `.cache/<label>` (§13.5, §14.4) | FR-05.3 | M |
| M7.3 | 다이어그램 `format: png` (§14.2) | FR-05.3 | S~M |
| M7.4 | 노트 임베드 `![[note]]` (@include 로더 재사용) | FR-05.3 | M |
| M7.5 | 입력 중 단어 제안(completion) | REQ-002 §3 | M~L |
| M7.6 | 성능 측정과 개선: 콜드 스타트 300ms, 10MB 문서 | NFR-02, NFR-03 | M |

### 확인 필요 (의심 사항, 재현 후 분류)

- 프리뷰의 상대 경로 이미지(`![](assets/x.png)`, TextBundle 자산) 표시
- 에디터 모드 인쇄 시 긴 문서가 잘림(보이는 줄만 렌더링)
- `settings.json`을 직접 편집했을 때 재시작 전까지 반영 안 됨
- 저장 시 공백 제거 후에도 버퍼에는 공백이 남고 깨끗한 상태로 표시
- 종료 중 한 창에서 취소해도 다른 창은 계속 닫힘
- "항상 위에"가 창별이 아니라 전역
- 열기에 실패한 파일도 최근 문서에 추가
- Markdown Super Set: 한 단어 대괄호(`[note]`)가 키 표시로 바뀜, 첫 줄 `Note: …`가 메타데이터로 해석, `$…%%…$`의 `%%` 처리
