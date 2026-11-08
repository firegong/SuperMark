# MarkEdit-Win (MarkEdit for Windows)

macOS용 오픈소스 경량 마크다운 에디터인 **[MarkEdit](https://github.com/MarkEdit-app/MarkEdit)** 를 **Tauri v2 (Rust + Microsoft Edge WebView2)** 기반으로 Windows 환경에 포팅하는 프로젝트입니다.

## 핵심 목표 (Core Philosophy)

MarkEdit 본연의 철학인 **"크기(Size), 속도(Speed), 네이티브 통합(Native Integration), 정확성(Correctness)의 균형"** 을 Windows에서도 그대로 달성합니다.

- **초경량 배포 (~4~5 MB)**: Electron 대신 Windows 10/11 내장 `WebView2`와 Rust(`Tauri v2`) 네이티브 셸을 결합합니다.
- **검증된 에디터 엔진 재사용**: CodeMirror 6 + Lezer 기반의 `CoreEditor` 및 `MarkEdit-api` 확장 생태계를 95% 이상 그대로 재사용합니다.
- **자동 코드 생성 기반 양방향 브리지**: `ts-gyb` + Mustache 템플릿 파이프라인을 확장하여 TypeScript 브리지 명세에서 Rust IPC 핸들러/디스패처 코드를 자동 생성합니다.

---

## 저장소 폴더 구조 (Deliverables & Source Layout)

소프트웨어 개발 생명주기(SDLC) 산출물과 소스 코드를 체계적으로 관리하기 위한 표준 디렉터리 구조입니다.

```text
MarkEdit-Win/
├── README.md                                 # 프로젝트 개요 및 안내
├── .gitignore                                # Git 추적 제외 규칙
├── docs/                                     # 소프트웨어 공학 개발 산출물 (SDLC Artifacts)
│   ├── 01-requirements/                      # [분석/요구사항]
│   │   ├── 01-feasibility-analysis.md        # MarkEdit 아키텍처 해부 및 Windows 포팅 타당성 분석서
│   │   └── 02-srs-porting-requirements.md    # Windows 포팅 요구사항 명세서 (기능/비기능/대체 범위)
│   ├── 02-architecture/                      # [아키텍처 설계]
│   │   ├── 01-system-architecture.md         # Tauri v2 + WebView2 + CoreEditor 하이브리드 아키텍처
│   │   └── 02-bridge-rpc-specification.md    # Native(7종) ↔ Web(12종) 전체 브리지 RPC 명세 및 매핑
│   ├── 03-design/                            # [상세 설계]
│   │   └── 01-window-and-document-lifecycle.md # NSDocument 대체 문서 수명주기 및 상태 관리 설계
│   ├── 04-roadmap/                           # [일정/로드맵]
│   │   └── 01-implementation-roadmap.md      # Phase 1~3 단계별 구현 계획 및 마일스톤
│   └── 05-testing/                           # [테스트/검증]
│       └── 01-test-and-verification-plan.md  # 단위/통합/성능 검증 계획서
├── packages/                                 # 프론트엔드 및 에디터 코어 패키지
│   └── core-editor/                          # MarkEdit CoreEditor (CodeMirror 6 + Bridge 어댑터)
├── src-tauri/                                # Windows 네이티브 호스트 (Rust / Tauri v2)
└── scripts/                                  # ts-gyb 코드 생성 및 빌드 자동화 스크립트
```

---

## 주요 산출물 바로가기

1. **[포팅 타당성 및 아키텍처 분석서](docs/01-requirements/01-feasibility-analysis.md)**
2. **[Windows 포팅 요구사항 명세서 (SRS)](docs/01-requirements/02-srs-porting-requirements.md)**
3. **[시스템 아키텍처 설계서](docs/02-architecture/01-system-architecture.md)**
4. **[양방향 브리지(Native ↔ Web) RPC 상세 명세서](docs/02-architecture/02-bridge-rpc-specification.md)**
5. **[문서 수명주기(`NSDocument` 대체) 상세 설계서](docs/03-design/01-window-and-document-lifecycle.md)**
6. **[단계별 구현 로드맵](docs/04-roadmap/01-implementation-roadmap.md)**
7. **[테스트 및 검증 계획서](docs/05-testing/01-test-and-verification-plan.md)**

---

## 라이선스 및 출처

- 원작 프로젝트: [MarkEdit-app/MarkEdit](https://github.com/MarkEdit-app/MarkEdit) (MIT License, Copyright (c) cyanzhong and contributors)
- 본 프로젝트는 MIT 라이선스를 준수하며 원작자의 아키텍처와 `CoreEditor` 에셋을 기반으로 Windows 네이티브 호스트를 구현합니다.
