# `packages/core-editor`

이 디렉터리에는 [`MarkEdit-app/MarkEdit`](https://github.com/MarkEdit-app/MarkEdit)의 `CoreEditor` 패키지(CodeMirror 6 기반 웹 에디터 코어)가 위치합니다.

## 주요 역할
- CodeMirror 6 + Lezer 기반 GitHub Flavored Markdown 편집기
- `src/bridge/`: Native ↔ Web 양방향 브리지 인터페이스 정의
- `src/@codegen/`: `ts-gyb` 기반 네이티브 바인딩 코드 생성기 (Rust 템플릿 포함)
- `vite-plugin-singlefile`을 통한 단일 HTML 번들(`dist/index.html`) 빌드
