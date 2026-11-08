# 단계별 구현 로드맵 (Implementation Roadmap)

- **문서 번호**: `PLAN-001`
- **작성일**: 2026-11-08
- **상태**: Draft v1.0

---

## 전체 개발 단계 요약

| 단계 | 목표 | 핵심 산출물 | 예상 소요 (AI 협업 기준) |
| :--- | :--- | :--- | :---: |
| **Phase 1** | 코어 이식 및 PoC 구동 | `CoreEditor` 빌드 + WebView2 브리지 어댑터 + Tauri 단일 창 편집/저장 | **2 ~ 3일** |
| **Phase 2** | 코드 생성 및 핵심 기능 완성 | `ts-gyb` Rust 코드젠 + 메뉴바/단축키 + 검색/바꾸기 + TOC/통계 UI | **5 ~ 7일** |
| **Phase 3** | 확장 생태계 및 배포 완성도 | `MarkEdit-api` 유저 스크립트 로더 + 다중 창/자동복구 + 설치 패키지(`.msi`/`.exe`) | **5 ~ 7일** |

---

## Phase 1: 코어 이식 및 개념 검증 (PoC) — 완료
- [x] **M1.1**: 업스트림 `MarkEdit/CoreEditor` 소스 가져오기 (`packages/core-editor`) 및 Yarn 빌드/단위 테스트(`yarn test` 35개 스위트 / 482개 테스트) 통과 확인
- [x] **M1.2**: `CoreEditor/src/bridge/nativeModule.ts` 및 `contextRequest.ts`에 Tauri v2 / WebView2 IPC 브리지 호환 레이어 추가
- [x] **M1.3**: `CoreEditor` 내 Windows 단축키/클릭 수정자(`Ctrl+Click` 링크 이동 및 체크박스 토글) 플랫폼 분기 패치
- [x] **M1.4**: `src-tauri` 프로젝트 초기화 및 `CoreEditor` 단일 파일 번들을 로드해 로컬 `.md` 파일 열기·편집·저장(UTF-8 BOM 및 LF/CRLF 보존) 동작 구현 및 검증

## Phase 2: 브리지 자동 생성 및 Windows 네이티브 셸 구축
- [ ] **M2.1**: `CoreEditor/src/@codegen`에 Rust용 Mustache 템플릿 4종(`rust-config`, `rust-native-module`, `rust-web-module`, `rust-shared-types`) 작성 및 `ts-gyb` 연동
- [ ] **M2.2**: Windows 네이티브 메뉴바(`File`, `Edit`, `Format`, `View`, `Window`, `Help`) 및 단축키 라우팅 구현 (`muda`)
- [ ] **M2.3**: `DocumentManager` 구현 (인코딩 감지, LF/CRLF 보존, 더티 상태 표시, 닫기 전 저장 확인 모달, 외부 파일 변경 감시)
- [ ] **M2.4**: 상단 검색/바꾸기 바(Find & Replace), 목차(TOC) 드롭다운, 문서 통계(Statistics) 오버레이 구현
- [ ] **M2.5**: `%APPDATA%/MarkEdit/settings.json` 로더 및 실시간 설정 반영(`webModules.config.*`) 구현

## Phase 3: 확장 생태계(`MarkEdit-api`) 호환 및 제품화
- [ ] **M3.1**: `%APPDATA%/MarkEdit/scripts` 및 `styles` 로더 구현 (`__prepareScriptContexts__` 연동)
- [ ] **M3.2**: 확장용 네이티브 API (`NativeModuleAPI` 컨텍스트 메뉴, 알림창, 파일시스템, 클립보드, `secretStorage` Windows Credential Locker) 완성
- [ ] **M3.3**: 비정상 종료 대비 백그라운드 자동 백업(Hot Exit) 및 `.textbundle` 포맷 지원
- [ ] **M3.4**: Windows 파일 연결(`.md`, `.markdown` 기본 프로그램 등록), 아이콘, NSIS/MSI 설치 프로그램 및 GitHub Actions 자동 빌드 파이프라인 구축
