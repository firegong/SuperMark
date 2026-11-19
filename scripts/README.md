# `scripts`

이 디렉터리에는 업스트림 `CoreEditor` 동기화, `ts-gyb` 브리지 코드 생성, 빌드 및 패키징 자동화 스크립트가 위치합니다.

## 앱 빌드 (`build-app.sh`, `build-app.ps1`)

Tauri CLI 없이 실행 가능한 **프로덕션** 바이너리를 만든다.

```bash
scripts/build-app.sh          # macOS / Linux
```

```powershell
scripts\build-app.ps1         # Windows
```

> `cargo build --release`만 실행하면 **개발용** 바이너리가 만들어진다. 이 바이너리는 에디터 화면을
> Vite 개발 서버(`http://localhost:5173`)에서 불러오므로, 개발 서버가 없으면 빈 창이 뜨고 파일 내용이
> 보이지 않는다. 스크립트는 `tauri/custom-protocol` 기능으로 `packages/core-editor/dist`를 바이너리에
> 포함시킨다(`tauri build`와 같은 방식).
