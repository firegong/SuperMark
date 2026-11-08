# `src-tauri` (Windows Native Host)

이 디렉터리에는 Tauri v2 (Rust + Microsoft Edge WebView2) 기반의 Windows 네이티브 호스트 애플리케이션 코드가 위치합니다.

## 모듈 구조 (예정)
- `src/main.rs` / `src/lib.rs`: 앱 엔트리포인트 및 Tauri 빌더 설정
- `src/bridge/`:
  - `generated/`: `ts-gyb`가 자동 생성한 Native/Web RPC 트레잇 및 공유 DTO
  - `dispatcher.rs`: WebView2 ↔ Rust 브리지 메시지 라우터
- `src/document/`: `NSDocument`를 대체하는 문서 세션, 인코딩/줄바꿈 처리, 파일 워처, 자동 백업 관리
- `src/menu/`: Windows 네이티브 메뉴바 및 컨텍스트 메뉴 (`muda`)
- `src/settings/`: `%APPDATA%/MarkEdit/settings.json` 및 유저 스크립트/스타일 로더
