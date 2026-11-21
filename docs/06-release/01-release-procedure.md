# 릴리스 절차

- **문서 번호**: `REL-001`
- **작성일**: 2026-11-21
- **상태**: v1.0
- **관련 문서**: `ARCH-001` §8.1 릴리스와 앱 자체 업데이트, `REQ-002` FR-03.7

---

## 1. 구성 한눈에 보기

| 항목 | 값 |
| --- | --- |
| 소스 저장소 (비공개) | `firegong/SuperMark` |
| 릴리스 저장소 (공개) | `firegong/SuperMark-releases` — 설치 파일과 업데이트 파일만 올라간다 |
| 워크플로 | `.github/workflows/release.yml` (`v*` 태그 푸시 또는 수동 실행) |
| 빌드 대상 | Windows(NSIS·MSI 설치 파일, 단일 실행 파일), macOS Apple Silicon·Intel 각각(`.app`/`.dmg`) |
| 업데이트 확인 주소 | `https://github.com/firegong/SuperMark-releases/releases/latest/download/latest.json` |
| 서명 | minisign. 공개 키는 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`, 개인 키는 GitHub Secrets |

```text
v* 태그 푸시 (firegong/SuperMark)
  └─ release.yml (Windows, macOS Apple Silicon, macOS Intel 동시 — Intel은 Apple Silicon 러너에서 교차 컴파일)
       ├─ yarn build (에디터)  →  tauri build (서명된 설치·업데이트 파일)
       └─ tauri-action: firegong/SuperMark-releases 에 초안 릴리스 + latest.json
사람이 초안 확인 후 게시(Publish)
  └─ 설치된 앱: 시작 시 / 메뉴 "Check for Updates…" → latest.json → 서명 검증 → 설치·재시작
```

---

## 2. 최초 설정 (한 번만)

이미 끝난 항목: 릴리스 저장소 생성(README 커밋 포함), 공개 키 반영, Secrets 3개 등록 (2026-11-21).

### 2.1 서명 키

```bash
npx @tauri-apps/cli@2 signer generate -w ~/.tauri/supermark-updater.key -p '<비밀번호>'
```

- `~/.tauri/supermark-updater.key`(개인 키)와 `.key.pub`(공개 키)가 만들어진다.
- 공개 키 파일의 내용을 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`에 넣는다.
- **개인 키와 비밀번호를 잃으면 기존 설치본에 업데이트를 보낼 수 없다.** 개인 키 파일과 비밀번호를 비밀번호 관리자 등 안전한 곳에 따로 보관한다.
- 키를 바꾸면(분실 등) 이미 설치된 앱은 새 키로 서명된 업데이트를 거부한다. 새 공개 키가 들어간 버전을 사용자가 한 번 직접 설치해야 한다.

### 2.2 GitHub Secrets (`firegong/SuperMark` → Settings → Secrets and variables → Actions)

| 이름 | 내용 | 등록 명령 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 개인 키 파일의 내용 | `gh secret set TAURI_SIGNING_PRIVATE_KEY -R firegong/SuperMark < ~/.tauri/supermark-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 키 비밀번호 | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R firegong/SuperMark` (입력 창에 붙여 넣기) |
| `RELEASES_TOKEN` | 릴리스 저장소에 쓸 수 있는 토큰 (`github_pat_…`) | `gh secret set RELEASES_TOKEN -R firegong/SuperMark` (입력 창에 붙여 넣기) |

`RELEASES_TOKEN` 만들기: <https://github.com/settings/personal-access-tokens/new>

- Repository access: **Only select repositories** → `firegong/SuperMark-releases`
- Repository permissions → **Contents: Read and write**
- 만료일을 정했다면 만료 전에 새로 만들어 같은 이름으로 다시 등록한다.

`gh secret set`의 입력 창은 붙여 넣은 내용을 화면에 표시하지 않는다. 등록 여부는 `gh secret list -R firegong/SuperMark`로 확인한다(값은 볼 수 없다).

---

## 3. 릴리스 절차 (매번)

### 3.1 준비

1. 출시할 코드가 기준 브랜치에 커밋되어 있고 테스트가 통과하는지 확인한다.
   ```bash
   cd packages/core-editor && yarn build && npx jest
   ```
   ```bash
   cd src-tauri && cargo test
   ```
2. 버전을 올린다. **두 곳을 같은 값으로**: `src-tauri/tauri.conf.json`의 `"version"`, `src-tauri/Cargo.toml`의 `version`.
   - 앱은 설치된 버전보다 **높은** 버전만 업데이트로 제안한다(SemVer 비교). 이미 쓴 버전이나 낮은 버전은 쓰지 않는다.
   - 기존 태그 확인: `git tag --list 'v*'`
3. 변경을 커밋한다. 예: `chore: release 0.3.0`

### 3.2 빌드 시작

```bash
git tag -a v0.3.0 -m "SuperMark 0.3.0"
```
```bash
git push origin <브랜치> && git push origin v0.3.0
```

- 태그 이름은 `v` + 설정 파일의 버전과 같게 한다. 워크플로는 태그 푸시로 시작된다.
- 태그 없이 다시 빌드하려면 GitHub Actions → *Release Build* → **Run workflow**(태그 이름은 `v__VERSION__`, 즉 설정 파일의 버전으로 정해진다).
- 진행 확인: `gh run list -R firegong/SuperMark -L 3`, `gh run watch <run-id> -R firegong/SuperMark`
- 작업 3개(Windows, macOS aarch64, macOS x86_64)가 동시에 돌아간다. 소요 시간: 보통 15~25분(Windows가 더 오래 걸린다).

### 3.3 초안 확인

세 작업이 모두 성공하면 `firegong/SuperMark-releases`에 **초안(draft)** 릴리스가 생긴다.

```bash
gh release view v0.3.0 -R firegong/SuperMark-releases
```

자산에 다음이 있는지 확인한다(파일 이름은 예시이며 아키텍처에 따라 다르다).

| 자산 | 용도 |
| --- | --- |
| `SuperMark_<버전>_x64-setup.exe` + `.sig` | Windows 설치 파일과 서명(업데이트에도 사용). 배포 안내는 이 파일로 |
| `SuperMark_<버전>_x64_en-US.msi` + `.sig` | Windows MSI 설치 파일(관리 배포용) |
| `SuperMark_<버전>_x64_portable.exe` | Windows 단일 실행 파일(설치 없이 실행, §4.1) |
| `SuperMark_<버전>_aarch64.dmg`, `SuperMark_<버전>_x64.dmg` | macOS 설치 디스크 이미지(Apple Silicon, Intel) |
| `SuperMark_aarch64.app.tar.gz`, `SuperMark_x64.app.tar.gz` + `.sig` | macOS 업데이트 파일과 서명(Apple Silicon, Intel) |
| `latest.json` | 업데이트 목록: 버전, 릴리스 노트, 플랫폼별 주소와 서명(`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`) |

필요하면 릴리스 노트(본문)를 고친다. 본문은 앱의 업데이트 대화상자에 그대로 표시된다(1,200자까지).

### 3.4 게시

```bash
gh release edit v0.3.0 -R firegong/SuperMark-releases --draft=false --latest
```

또는 웹의 릴리스 페이지에서 **Publish release**. 게시 즉시 `releases/latest`가 이 릴리스를 가리키고, 설치된 앱이 업데이트를 찾는다. 초안과 사전 릴리스(pre-release)는 앱에 보이지 않으므로, 시험용은 초안 상태로 두고 직접 내려받아 확인할 수 있다.

### 3.5 확인

1. `latest.json`이 새 버전을 가리키는지 확인한다.
   ```bash
   curl -sL https://github.com/firegong/SuperMark-releases/releases/latest/download/latest.json
   ```
2. 이전 버전이 설치된 PC에서 SuperMark → **Check for Updates…** → 예 → 설치 후 재시작 → 다시 Check for Updates를 눌러 "is the latest version"에 새 버전 번호가 나오는지 확인.
3. Windows, Apple Silicon Mac, Intel Mac에서 각각 확인한다.

---

## 4. 앱의 업데이트 동작 (참고)

| 상황 | 동작 |
| --- | --- |
| 시작 시 (릴리스 빌드, 설정 → General → *Check for Updates Automatically*, 기본 켜짐) | 5초 뒤 한 번 확인. 새 버전이 있을 때만 대화상자 |
| 메뉴 *Check for Updates…* | 최신 여부·오류·새 버전을 항상 알림 |
| 대화상자 | 예 = 내려받아 설치 후 재시작, 아니요 = 나중에, 취소 = 이 버전 건너뛰기(`general.skippedUpdateVersion`, 메뉴로 확인하면 다시 제안) |
| 저장하지 않은 문서가 있을 때 | 설치하지 않고 저장을 먼저 요청 |
| 서명 불일치 | 설치하지 않음 (오류는 `logs/markedit.log`) |
| Windows | NSIS 설치 프로그램이 passive 모드(진행 창만 표시)로 이어받고 앱이 종료·재시작 |

### 4.1 Windows 단일 실행 파일 (portable)

- `SuperMark_<버전>_x64_portable.exe` 하나로 실행된다. 에디터·폰트·Mermaid가 실행 파일에 포함되어 있다.
- WebView2 런타임이 PC에 있어야 한다(Windows 10·11은 대부분 기본 설치). 시작 메뉴·파일 연결은 없다.
- 설정·백업은 설치 버전과 같은 `%APPDATA%\MarkEdit`를 쓴다.
- 스스로 업데이트하지 않는다. 새 버전을 찾으면 대화상자의 예 = **다운로드 페이지 열기**. 새 파일로 바꿔 쓰면 된다.
- 빌드: 워크플로의 Windows 작업이 설치 파일을 만든 뒤 `cargo build --release --features "tauri/custom-protocol portable"`로 다시 빌드해 올린다(`portable` 기능, `src-tauri/src/updates.rs`의 `PORTABLE`).

업데이트 기능은 0.2.0부터 들어 있다(단일 실행 파일은 0.2.1부터). 그보다 오래된 설치본은 한 번 직접 설치해야 한다.

---

## 5. 문제 해결

| 증상 | 원인과 조치 |
| --- | --- |
| `Cannot convert argument to a ByteString because the character at index 6 …` | `RELEASES_TOKEN`에 토큰이 아닌 값(예: 한글 비밀번호)이 들어 있음. 토큰을 다시 만들어 등록하고 `gh run rerun <run-id> --failed -R firegong/SuperMark` |
| `Bad credentials`, `Resource not accessible by personal access token`, 404 | 토큰 만료 또는 권한 부족. 대상 저장소 `SuperMark-releases`, Contents: Read and write로 다시 만들어 등록 |
| 서명 단계 실패(`incorrect password`, `failed to decode`) | `TAURI_SIGNING_PRIVATE_KEY`/`…_PASSWORD`가 키와 맞지 않음. 키 파일 내용과 비밀번호를 다시 등록 |
| `Reference does not exist` / 태그 생성 실패 | 릴리스 저장소에 `main` 브랜치(첫 커밋)가 없음. README를 커밋해 `main`을 만든다 |
| 단일 실행 파일만 없음 | Windows 작업의 마지막 단계 실패. 로그 확인 후 `gh run rerun <run-id> --failed` (설치 파일은 `--clobber`로 덮어씀) |
| 한 OS만 실패 | 실패한 작업만 다시 실행(`gh run rerun <run-id> --failed`). 같은 초안에 자산이 추가된다 |
| 앱이 "latest version"이라고만 함 | 릴리스가 아직 초안이거나 사전 릴리스, 또는 버전을 올리지 않음 |
| 앱이 서명 오류로 설치 거부 | 빌드에 쓴 개인 키와 앱의 공개 키가 다름(키를 바꾼 경우). 새 공개 키가 든 버전을 직접 설치 |
| 같은 버전으로 다시 빌드 | 초안을 지우고(`gh release delete v0.3.0 -R firegong/SuperMark-releases --cleanup-tag`) 태그를 다시 푸시하거나 워크플로를 수동 실행 |

진행 중 실패한 작업의 로그: `gh run view <run-id> -R firegong/SuperMark --log-failed`
