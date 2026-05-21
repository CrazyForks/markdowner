# Markdowner

[English README](README.md)

Markdowner는 `Tauri v2`, `React`, `Vite`, `Tiptap` 기반으로 구성된 Rust 중심 Markdown 데스크톱 에디터입니다. 현재 저장소에는 macOS에서 실제로 실행 가능한 데스크톱 셸, 공유 Rust 문서 코어, 그리고 향후 Windows 빌드를 위한 첫 번째 크로스플랫폼 기반이 포함되어 있습니다.

## 현재 상태

- `pnpm tauri dev` 로 macOS 로컬 개발 실행이 가능합니다
- `pnpm tauri build --debug` 로 macOS 로컬 debug 빌드가 가능합니다
- `pnpm build:mac:dmg` 로 ad-hoc signing 이 적용된 무료 macOS DMG 배포 빌드를 만들 수 있습니다
- 앱 셸에는 파일 열기, 폴더 열기, 저장, 명령 팔레트, 빠른 열기, 모드 전환, 테마 전환, 드래그 앤 드롭 열기, `markdowner-core` 와 연결되는 Rust command bridge 가 포함되어 있습니다
- 사이드 패널에 문서 목차가 구현되어 있으며 헤딩 클릭으로 줄 점프가 가능합니다
- 안정성은 원자적 쓰기, 외부 변경 감지, ErrorBoundary fallback까지 적용되어 있습니다
- Windows 는 아직 후속 작업 범위이지만, 아키텍처는 같은 Tauri 앱 셸을 기준으로 맞춰져 있습니다

## 개발 진행상황 스냅샷

2026-05-05 기준 Markdowner는 macOS 개발자 프리뷰에 가까운 상태입니다. 핵심 데스크톱 루프는 사용할 수 있습니다. Markdown 파일 또는 워크스페이스를 열고, WYSIWYG/Source/Split View 사이를 전환하며 편집하고, 안전하게 저장하고, 최근 파일을 다시 열고, 테마를 바꾸고, 외부 변경 충돌을 처리할 수 있습니다. 현재 v1 제품 목표 대비 완성도는 대략 60-65% 수준으로 보는 것이 맞습니다. 셸, 코어 파일 모델, 설정 영속화, 일반적인 Markdown 왕복 저장 경로는 자리 잡았고, 고급 작성 기능, export, 검색, 배포 품질, Windows 검증은 아직 남아 있습니다.

완료 또는 안정권에 있는 항목:

- Tauri v2 데스크톱 셸과 React 19, Vite 7, TypeScript, Tiptap, CodeMirror, React Markdown, shadcn 스타일 UI 구성
- `markdowner-core`, `src-tauri` Tauri bridge, 기존 `markdowner-macos` reference crate 로 나뉜 Rust workspace
- 파일 생명주기: 새 문서, 파일 열기, 워크스페이스 열기, 저장, 다른 이름으로 저장, 최근 문서, CLI 경로 열기, single-instance 라우팅, 드래그 앤 드롭 파일/폴더 열기, native menu command event
- 안전성 모델: 원자적 쓰기, 읽기 전용 파일 보호, 외부 디스크 변경 감지, 비교/다시 로드/로컬 유지 흐름, dirty close confirmation, 세션 복원
- 탐색과 셸 UX: Activity Bar, 리사이즈/접힘 가능한 사이드바, 워크스페이스 트리, 파일명 필터, Quick Open, Command Palette, Outline 패널, 문서 통계, Status Bar metadata
- Markdown coverage: heading, paragraph, quote, bullet, checklist, image, table, fenced code block, link, emphasis, inline code, raw-preserved unsupported block
- 설정 영속화와 런타임 동작: autosave, editor font, word wrap, startup mode, focus/typewriter writing aid, system theme following, diagnostics logging. asset folder와 PDF paper size preference는 후속 asset/export workflow를 위해 저장됩니다
- 사용자 CSS 테마 import 검증과 Markdown content surface 로의 frontend scoping

부분 완료 항목:

- Asset folder와 PDF paper size는 설정으로 저장되지만, 실제 런타임 동작은 이미지 asset/export workflow 구현에 맞춰 연결될 예정입니다
- 코드 하이라이팅은 Rust core 모델에 알려진 code fence 기준으로 존재하지만, frontend preview/WYSIWYG 하이라이팅 정책은 제품 수준 polish가 더 필요합니다
- 무료 직접 배포용 macOS DMG 생성은 가능하지만, 유료 Developer ID signing/notarization 과 release metadata 는 아직 미완료입니다
- Rust core와 React shell 테스트는 의미 있게 존재하지만, 전체 데스크톱 E2E, screenshot regression, 자동 접근성 gate는 아직 없습니다

미구현 항목:

- 본문 Find & Replace
- Slash command menu
- KaTeX 수식 및 Mermaid diagram rendering
- HTML/PDF/Print export
- Workspace full-text search
- 이미지 paste/drop asset 복사 및 상대경로 삽입
- overwrite 전 자동 백업
- Window size/position restore
- Windows build/test/release 검증

## 기능 요약

- Tiptap 기반 WYSIWYG 편집 화면
- CodeMirror 6 기반 Source 모드
- React Markdown + GFM 기반 Preview 모드
- 데스크톱 셸을 통한 파일 열기/저장
- 명령 팔레트(`⌘⇧P`) 및 빠른 열기(`⌘P`)로 파일·커맨드 탐색
- 워크스페이스 폴더 열기와 파일 트리 탐색
- 문서 통계 다이얼로그와 아웃라인 패널
- 이미지, 표, 체크리스트, fenced code block 지원
- 기본 라이트/다크 테마 및 사용자 CSS 테마 import
- 설정 다이얼로그에서 오토세이브, 글꼴, 줄 바꿈, 시작 모드, 시스템 테마 연동, asset, PDF, diagnostics preference 편집 가능
- Markdown 저장 형식과 문서 의미 모델은 Rust `markdowner-core` 가 담당

## 저장소 구성

- `crates/markdowner-core`: Markdown 파싱/직렬화, 문서 모델, 테마, 워크스페이스 상태, 런타임 로직
- `crates/markdowner-macos`: 경계 검증과 회귀 테스트를 위한 기존 macOS shell/reference crate
- `src`: React/Vite 프런트엔드 셸
- `src-tauri`: Tauri 데스크톱 셸, Rust command bridge, 앱 설정
- `docs/architecture/core-platform-boundary.md`: 코어/플랫폼 분리에 대한 아키텍처 문서

## macOS 개발환경 설정

현재 저장소는 macOS에서 아래 도구체인으로 로컬 검증되었습니다.

- `Node.js v22.20.0`
- `pnpm v10.33.0`
- `cargo 1.94.0`
- `rustc 1.94.0`
- `xcode-select` 로 확인 가능한 Xcode Command Line Tools

최소 준비 항목:

1. 최신 Rust 툴체인 설치
2. Node.js 와 pnpm 설치
3. Xcode Command Line Tools 설치

확인 명령 예시:

```bash
node -v
pnpm -v
cargo -V
rustc -V
xcode-select -p
xcrun --version
```

## 의존성 설치

```bash
pnpm install
```

환경에 따라 `pnpm install` 중 ignored build scripts 경고가 뜨면, 필요한 build script 를 승인한 뒤 다시 설치하세요.

```bash
pnpm approve-builds
pnpm install
```

## macOS 로컬 개발 실행

개발 모드로 데스크톱 앱을 실행하려면:

```bash
pnpm tauri dev
```

이 명령은 다음을 수행합니다.

- `http://127.0.0.1:14238` 에 Vite dev server 실행
- Tauri Rust 셸 컴파일
- 로컬 debug 데스크톱 실행 파일 실행

이 저장소에서 실제로 검증한 결과, 시작 시 먼저 `pnpm dev` 가 실행되고 이어서 `target/debug/markdowner-desktop` 이 실행됩니다.

`pnpm tauri dev` 가 바로 실패하면, `14238` 포트가 이미 사용 중인지 먼저 확인하세요. Markdowner는 다른 프로젝트의 dev server에 조용히 붙지 않도록 Vite dev server를 `127.0.0.1:14238`에 `strictPort`로 고정합니다.

## macOS 로컬 빌드

### Rust 워크스페이스 빌드

```bash
cargo build
```

새 환경에서는 첫 Rust 빌드 시 crates.io 에서 crate 의존성을 내려받기 때문에, 이후 빌드보다 시간이 더 오래 걸릴 수 있습니다.

### 프런트엔드 번들 빌드

```bash
pnpm build
```

### 로컬 Tauri debug 앱 빌드

```bash
pnpm tauri build --debug
```

검증된 산출물 경로:

```bash
target/debug/markdowner-desktop
```

## 빌드와 설치 명령 (macOS)

일반 프런트엔드 프로덕션 빌드는 그대로 `pnpm build` 를 사용합니다. Tauri 번들 빌드, 로컬 설치, 설치 후 실행 흐름이 필요할 때는 build 하위 명령을 붙입니다.

```bash
pnpm build                         # 타입 체크와 프런트엔드 빌드
pnpm build debug                   # Tauri 디버그 빌드
pnpm build dmg                     # ad-hoc signing 이 적용된 릴리즈 DMG 빌드
pnpm build universal dmg           # Apple Silicon + Intel universal DMG 빌드
pnpm build install                 # Tauri 릴리즈 빌드 후 /Applications 에 설치
pnpm build install open            # 설치 후 설치된 앱 실행
pnpm build debug install open      # 디버그 빌드, 설치, 실행
pnpm build:install:open            # 설치 + 실행 package-script alias
pnpm build:mac:dmg                 # 릴리즈 DMG package-script alias
pnpm build:mac:universal:dmg       # universal DMG package-script alias
```

설치 옵션:

```bash
MARKDOWNER_INSTALL_PATH=~/Applications pnpm build install
pnpm build install -- --path ~/Applications
pnpm build install -- --no-build   # 이미 빌드된 번들을 설치만 수행
pnpm build install -- --open       # "open" 의 flag 형태
```

동작:

- 하위 명령 없는 `pnpm build` 는 Tauri `beforeBuildCommand` 에서 사용하는 프런트엔드 빌드를 실행합니다
- `install` 은 macOS 전용입니다 (`src-tauri/tauri.conf.json` 의 bundle target 이 `app` 입니다)
- 기본 설치 경로는 `/Applications` 이며, `MARKDOWNER_INSTALL_PATH` 또는 `--path <DIR>` 로 변경할 수 있습니다
- 설치 경로에 쓰기 권한이 없을 때만 자동으로 `sudo` 를 사용합니다
- 대상 위치에 기존 `Markdowner.app` 이 있으면 제거한 뒤 `ditto` 로 복사하고, 로컬 빌드 번들이 Gatekeeper 경고 없이 실행되도록 `com.apple.quarantine` 속성을 제거합니다
- `open` 또는 `--open` 을 주면 복사 후 설치된 번들을 실행합니다
- `scripts/build-and-install.sh` 는 `pnpm build install` 을 감싼 호환용 wrapper 로 남겨두었습니다

## 무료 macOS DMG 배포

Markdowner는 `src-tauri/tauri.conf.json` 에서 Tauri ad-hoc macOS signing 을 사용하도록 설정되어 있습니다.

```json
"signingIdentity": "-"
```

직접 다운로드로 보낼 DMG는 다음 명령으로 만듭니다.

```bash
pnpm build:mac:dmg
```

명령 실행 후 생성된 `.dmg` 경로와 SHA-256 checksum 이 출력됩니다. DMG와 checksum 을 같이 공유하면, 받는 사람이 다운로드한 파일이 원본과 같은지 확인할 수 있습니다.

Apple Silicon 과 Intel Mac 을 하나의 DMG로 지원하려면 Rust target 두 개를 한 번 설치한 뒤 universal 빌드를 실행합니다.

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm build:mac:universal:dmg
```

중요한 제한: ad-hoc signing 은 Developer ID signing 이 아니며 notarization 도 아닙니다. 다운로드한 DMG는 첫 실행 시 상대방 Mac 에서 Privacy & Security 수동 허용이 필요할 수 있습니다. 일반 사용자에게 경고 없는 더블클릭 실행 경험을 제공하려면 여전히 유료 Apple Developer Program, Developer ID 인증서, notarization 이 필요합니다.

테스터에게 전달할 실행 안내문:

```text
1. DMG를 열고 Markdowner.app을 Applications 폴더로 옮깁니다.
2. Markdowner를 한 번 실행해 봅니다.
3. macOS가 실행을 막으면 System Settings -> Privacy & Security를 엽니다.
4. Security 영역에서 Markdowner의 Open Anyway를 누릅니다.
5. 다시 Open을 누르면 이후에는 일반 앱처럼 실행됩니다.
```

### `scripts/build-and-run.sh`

Tauri 앱을 빌드하고 곧바로 실행합니다.

```bash
scripts/build-and-run.sh           # 릴리즈 빌드 후 .app 실행
scripts/build-and-run.sh --debug   # 디버그 빌드
scripts/build-and-run.sh --no-run  # 빌드만 수행, 실행하지 않음
```

동작:

- `pnpm`, `cargo` 가 `PATH` 에 있는지 확인합니다
- `node_modules` 가 없으면 `pnpm install` 을 실행합니다
- `pnpm tauri build` (또는 `pnpm tauri build --debug`) 를 실행합니다
- macOS 에서는 `target/{release,debug}/bundle/macos/Markdowner.app` 을 `open` 으로 실행하고, 그 외 플랫폼에서는 `target/{release,debug}/markdowner-desktop` 바이너리를 직접 실행합니다

## 현재 앱 검증 방법

프런트엔드와 Rust 테스트 스위트:

```bash
pnpm test
cargo test
```

자주 쓰는 핵심 검증 명령:

```bash
cargo test -p markdowner-core
pnpm build
pnpm tauri build --debug
```

## 참고 사항과 현재 제한사항

- Tauri 데스크톱 셸은 macOS 로컬에서 동작하고 무료 ad-hoc DMG 생성도 가능합니다. 다만 일반 사용자에게 경고 없는 공개 배포를 제공하기 위한 유료 Developer ID signing/notarization 은 후속 작업입니다.
- 프런트엔드 프로덕션 번들은 현재 Vite chunk size warning 이 발생할 정도로 크기가 큽니다.
- Windows 지원은 다음 단계의 목표이며, 아직 완료된 로컬 개발 워크플로는 아닙니다.
- `crates/markdowner-macos` 는 Tauri 셸이 주 앱 진입점이 되는 동안 참고 구현과 회귀 기준으로 남겨둔 상태입니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 `LICENSE` 를 확인하세요.
