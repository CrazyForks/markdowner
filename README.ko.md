# Markdowner

[English README](README.md)

Markdowner는 `Tauri v2`, `React`, `Vite`, `Tiptap` 기반으로 구성된 Rust 중심 Markdown 데스크톱 에디터입니다. 현재 저장소에는 macOS에서 실제로 실행 가능한 데스크톱 셸, 공유 Rust 문서 코어, 그리고 향후 Windows 빌드를 위한 첫 번째 크로스플랫폼 기반이 포함되어 있습니다.

## 현재 상태

- `pnpm tauri dev` 로 macOS 로컬 개발 실행이 가능합니다
- `pnpm tauri build --debug` 로 macOS 로컬 debug 빌드가 가능합니다
- 앱 셸에는 파일 열기, 폴더 열기, 저장, 모드 전환, 테마 전환, `markdowner-core` 와 연결되는 Rust command bridge 가 포함되어 있습니다
- Windows 는 아직 후속 작업 범위이지만, 아키텍처는 같은 Tauri 앱 셸을 기준으로 맞춰져 있습니다

## 기능 요약

- Tiptap 기반 WYSIWYG 편집 화면
- CodeMirror 6 기반 Source 모드
- React Markdown + GFM 기반 Preview 모드
- 데스크톱 셸을 통한 파일 열기/저장
- 워크스페이스 폴더 열기와 파일 트리 탐색
- 이미지, 표, 체크리스트, fenced code block 지원
- 기본 라이트/다크 테마
- 세션 상태와 함께 저장되는 사용자 CSS 테마 import
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

- `http://localhost:1420` 에 Vite dev server 실행
- Tauri Rust 셸 컴파일
- 로컬 debug 데스크톱 실행 파일 실행

이 저장소에서 실제로 검증한 결과, 시작 시 먼저 `pnpm dev` 가 실행되고 이어서 `target/debug/markdowner-desktop` 이 실행됩니다.

`pnpm tauri dev` 가 바로 실패하면, 기본적으로 Vite dev server 가 `1420` 포트를 사용하므로 해당 포트가 이미 사용 중인지 먼저 확인하세요.

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

## 현재 앱 검증 방법

전체 Rust 테스트 스위트:

```bash
cargo test
```

자주 쓰는 핵심 검증 명령:

```bash
cargo test -p markdowner-core
pnpm build
pnpm tauri build --debug
```

## 참고 사항과 현재 제한사항

- Tauri 데스크톱 셸은 macOS 로컬에서 동작하지만, 패키징된 macOS `.app` 번들은 아직 활성화되어 있지 않습니다. 현재 `src-tauri/tauri.conf.json` 의 `"bundle.active"` 는 `false` 입니다.
- 프런트엔드 프로덕션 번들은 현재 Vite chunk size warning 이 발생할 정도로 크기가 큽니다.
- Windows 지원은 다음 단계의 목표이며, 아직 완료된 로컬 개발 워크플로는 아닙니다.
- `crates/markdowner-macos` 는 Tauri 셸이 주 앱 진입점이 되는 동안 참고 구현과 회귀 기준으로 남겨둔 상태입니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 `LICENSE` 를 확인하세요.
