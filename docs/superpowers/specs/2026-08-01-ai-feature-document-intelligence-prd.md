# Markdowner AI Feature v2 and Obsidian Front Matter PRD

- 상태: 제품 설계 승인 · 구현 전
- 작성일: 2026-08-01
- 대상 제품: Markdowner for macOS
- 기준선:
  [2026-07-31 OpenRouter AI Document Workbench PRD](./2026-07-31-openrouter-ai-document-workbench-prd.md)
- 제품 원칙: 사용자가 명시적으로 실행한 AI 작업만 클라우드로 전송하고, 검증과
  사용자 승인을 통과하지 않은 결과는 문서에 반영하지 않는다.

## 1. Executive Summary

### Problem Statement

최초 AI Workbench는 단일 문서의 일회성 PRD 개선, 번역, 선택 영역 변환을
지원하지만 현재 실행을 패널 밖에서 추적하거나 지난 결과를 다시 열 수 없다.
PRD 개선도 일회성 생성이라 사용자의 의도와 제약을 충분히 수집하지 못하며, 긴
번역 응답은 출력 한도에서 JSON 문자열이 잘려 로컬 검증에 실패할 수 있다.

Markdowner의 WYSIWYG 편집기는 문서 선두의 Obsidian YAML front matter를 의미
있는 속성으로 표시하거나 안전하게 편집하지 못한다. 사용자가 본문을 수정한 뒤
저장하면 Markdown 직렬화 과정에서 front matter 구조가 정규화되거나 손실될 위험도
있다.

### Proposed Solution

사용자 노출 명칭을 `AI Feature`로 통일하고, 사이드바를 `New`, `Activity`,
`History` 작업 공간으로 확장한다. Rust의 통합 AI 런타임이 실행, 취소, 진행률,
대화형 PRD 세션, 구조 인식 번역 청크와 SQLite 기록을 관리한다. 사용자는 현재
문서로 자동 지정된 범위를 다른 문서나 워크스페이스로 바꿀 수 있다.

PRD 개선은 한 번에 핵심 질문 하나를 묻는 지속 가능한 인터뷰가 되며 사용자가
충분하다고 판단할 때만 최종 결과를 생성한다. 번역은 Markdown 제목과 블록 경계로
자동 분할하고 청크별 검증, 재시도, 취소와 재개를 제공해 출력 한도에 의한 잘린
JSON을 사용자 오류로 노출하지 않는다.

WYSIWYG 문서 상단에는 접을 수 있는 `Document Properties` 카드를 제공한다.
단순 YAML 필드는 폼으로 편집하고 복합 또는 잘못된 YAML은 Raw 편집기로 다룬다.
본문만 편집할 때에는 기존 front matter 바이트를 그대로 보존한다.

### Success Criteria

1. `AI Feature` 사이드바 토글은 Activity Bar, Command Palette와 `⌘⇧A`에서 같은
   상태 전이를 실행하며, `Show Keyboard Shortcuts`에 해당 단축키가 100%
   노출된다.
2. 실행 상태는 시작 후 100ms 이내 표시되고, 정상 종료·실패·취소·비정상 종료의
   100%가 일관된 상태로 기록된다. 최근 500개 제한과 20개 단위 페이지네이션은
   1,000개 입력 부하 테스트에서도 정확해야 한다.
3. 50,000 estimated input token 이내의 장문 번역 fixture 20개에서 출력 한도에
   의한 최종 `invalid_schema` 오류가 0건이어야 한다. Markdown 보호 구조 보존율은
   100%이며, 중단한 청크부터 재개한 결과는 중단 없이 실행한 결과와 구조적으로
   동일해야 한다.
4. 결함을 주입한 한국어·영어 PRD 30개에서 중대 누락·모순·측정 불가능 요구사항
   재현율이 85% 이상이고, 전문가 유용성 평균이 5점 만점에 4.0 이상이어야 한다.
   사용자가 종료하지 않은 인터뷰가 임의로 종료되는 경우는 0건이어야 한다.
5. 제공된 Obsidian fixture를 포함한 유효·복합·잘못된 YAML fixture 40개에서 본문
   편집 후 front matter 바이트 보존율은 100%여야 한다. 속성 하나를 편집하면 해당
   값 이외의 필드 순서, 주석, 따옴표, Wiki 링크와 줄바꿈이 바뀌는 경우는
   0건이어야 한다.

### Fixed Product Decisions

- 사용자 노출 명칭은 `AI Feature`이다. 기존 `AI Workbench` 문구는 남기지 않는다.
- AI Feature 사이드바는 `New`, `Activity`, `History` 탭을 사용한다.
- 앱 내부 토글 단축키는 `⌘⇧A`이며 Command Palette와 단축키 도움말에도 같은
  명령을 제공한다.
- OpenRouter 기본 모델은 `z-ai/glm-5.2`이고 `moonshotai/kimi-k3`도 선택할 수
  있다. 모델은 자동 전환하지 않는다.
- 실행 범위는 현재 문서로 자동 지정되며 다른 문서나 워크스페이스로 바꿀 수 있다.
- 워크스페이스 번역은 Markdown 문서를 순차 일괄 처리한다. PRD 개선과 자유
  프롬프트에서 워크스페이스는 읽기 전용 참고 문맥이며 수정 대상은 선택 문서다.
- PRD 인터뷰는 질문 수를 고정하지 않는다. 사용자가 충분하다고 입력하거나 종료
  버튼을 누를 때만 최종 PRD를 생성한다.
- 실행과 인터뷰 기록은 로컬 SQLite에 최대 500개를 저장하고 20개씩 보여준다.
  전송한 원문 전체를 기록용으로 별도 복제하지 않는다.
- 번역은 Markdown 구조 인식 청크를 순차 처리하고 `3/8` 형태의 진행률을 보여준다.
- WYSIWYG front matter는 접이식 속성 카드를 기본으로 하고 Raw YAML 전환을
  제공한다.
- 결과는 기존 AI Review 흐름을 통해 검토하며 사용자 승인 없이 문서나 파일에
  적용하지 않는다.
- 구현과 검증 완료 후 Headatever patch release로 버전 커밋과 annotated tag를
  만들고 원격에 게시한다.

## 2. User Experience & Functionality

### User Personas

1. **제품 작성자**: 질문을 통해 생각을 구체화한 뒤 근거 있고 측정 가능한 PRD를
   만들고 싶다.
2. **다국어 검토자**: 긴 문서나 워크스페이스를 Markdown 구조 손실 없이 번역하고
   중단된 작업을 이어서 검토하고 싶다.
3. **에이전트 협업 개발자**: 실행 중인 AI 작업과 과거 결과를 한곳에서 관리하고
   선택 영역에 검토된 변환을 적용하고 싶다.
4. **Obsidian 사용자**: Properties 기반 Markdown 문서를 WYSIWYG로 편집하면서
   기존 YAML 스키마와 Wiki 링크를 보존하고 싶다.

### Primary User Flow

1. 사용자는 Activity Bar, `⌘⇧A` 또는 Command Palette에서 AI Feature를 연다.
2. `New`에서 작업을 선택하고 자동 지정된 범위, 모델과 작업별 옵션을 확인한다.
3. PRD 개선이면 인터뷰를 시작하고, 번역이면 대상 언어와 예상 청크·비용을
   확인한다.
4. 실행 후 하단 상태 레일과 `Activity`에서 진행률을 관찰하거나 취소한다.
5. 완료 결과는 AI Review에서 검토해 선택 적용, 전체 적용 또는 새 문서로 연다.
6. `History`에서 이전 작업을 20개씩 조회하고 상세 결과 또는 진행 중 PRD
   인터뷰를 다시 연다.

WYSIWYG 문서를 열 때 유효한 선두 YAML이 있으면 본문 위에 Document Properties
카드를 표시한다. 사용자는 카드를 접거나 펼치고, 단순 필드를 편집하거나 Raw YAML로
전환한다. front matter가 없는 문서에는 카드가 나타나지 않는다.

### Visual and Interaction Requirements

- 데스크톱 편집 도구에 맞는 조밀한 editorial layout을 사용하고 과도하게 큰 제목,
  의미 없는 빈 공간, 장식용 badge 군집을 만들지 않는다.
- `New`, `Activity`, `History`는 동일한 panel width에서 정보가 잘리지 않아야 하며
  폭이 좁을 때에는 열을 추가하지 않고 세로 흐름으로 전환한다.
- 현재 실행은 New 탭에서도 compact status rail로 보여 작업이 사라진 것처럼
  느껴지지 않게 한다.
- label, secondary text와 button은 배경 대비를 유지하고 상태를 색상 하나로만
  표현하지 않는다.
- 앱의 Geist typography와 기존 spacing token을 재사용한다.
- motion은 tab 전환과 진행 상태 변화의 짧은 transition으로 제한하고
  `prefers-reduced-motion`을 존중한다.

### User Stories and Acceptance Criteria

#### Story 1 — AI Feature 열기와 발견

> As a Markdowner user, I want one predictable command for AI Feature so that
> I can open or close it without hunting through the interface.

Acceptance criteria:

- Activity Bar의 AI 버튼 title과 접근성 이름은 `AI Feature`이다.
- `⌘⇧A`는 앱 포커스 안에서 AI Feature 사이드바를 토글한다.
- Command Palette에 `View: Toggle AI Feature` 명령이 있다.
- `Show Keyboard Shortcuts`의 View 섹션에
  `Toggle AI Feature — ⌘⇧A`가 표시된다.
- 버튼, 단축키와 Palette 명령은 하나의 action을 호출한다.
- 기존 `AI Workbench` 사용자 노출 문자열은 UI, 접근성 이름과 알림에 남지 않는다.

#### Story 2 — 작업과 범위 선택

> As a user, I want Markdowner to choose a sensible target automatically while
> letting me correct it before sending content.

Acceptance criteria:

- 새 실행의 기본 범위는 현재 활성 문서이다.
- 사용자는 현재 열린 문서, 워크스페이스의 Markdown 문서 또는 전체 워크스페이스를
  선택할 수 있다.
- 문서 범위에는 파일명과 워크스페이스 상대 경로를 함께 표시한다.
- 번역에서 워크스페이스는 ignore 설정을 적용한 Markdown 파일의 순차 batch다.
- PRD 개선과 자유 프롬프트에서 워크스페이스는 읽기 전용 참고 문맥이고 명시적으로
  선택한 문서 하나만 변경 대상이다.
- 실행 전 대상 파일 수, estimated input token, 예상 청크 수와 비용 상한을
  표시한다.
- 빈 범위, 읽을 수 없는 파일 또는 50,000 estimated input token을 넘는 단일
  문서는 실행하지 않고 범위를 줄이는 방법을 안내한다.

#### Story 3 — 현재 실행 관찰과 제어

> As a user, I want to see every running AI request so that I know what
> Markdowner is doing and can stop unnecessary work.

Acceptance criteria:

- `Activity`는 앱 전체에서 실행 중인 모든 요청을 시작 시간순으로 보여준다.
- 각 항목은 작업, 범위, 대상 또는 현재 파일, 모델, 시작 시간, 경과 시간, 단계와
  진행률을 포함한다.
- 번역은 `파일 2/5 · 청크 3/8 · Architecture`와 같이 중첩 진행률을 제공한다.
- 실행 항목마다 Cancel이 있고 취소 상태가 100ms 이내 화면에 반영된다.
- 앱은 동시에 최대 두 요청, 문서당 최대 한 요청이라는 기존 scheduler 계약을
  유지한다.
- 사이드바를 닫거나 탭을 바꿔도 요청과 진행률은 유지된다.
- 앱 종료 시 진행 중 작업은 다음 실행에서 `Interrupted`로 정리된다.

#### Story 4 — 상세 로컬 기록

> As a user, I want to reopen previous AI work so that I can inspect decisions,
> costs, and validated results without rerunning a request.

Acceptance criteria:

- History는 최신순으로 20개씩 표시하며 전체 개수와 현재 페이지를 보여준다.
- 기록에는 작업, 모델, 상태, 범위 설명, 질문·답변, 검증된 결과, 오류, prompt와
  completion token, 실제 또는 계산된 비용과 시간이 포함된다.
- 기록을 위해 요청 원문 전체를 별도 필드에 복제하지 않는다.
- 소스 식별에는 경로, 실행 시 해시와 필요한 segment 식별자만 저장한다.
- 최근 500개를 초과하면 가장 오래된 종료 기록부터 같은 transaction에서 삭제한다.
- 사용자는 개별 기록과 전체 기록을 삭제할 수 있다.
- 진행 중 PRD 인터뷰는 History에서 이어서 열 수 있다.
- 삭제한 기록은 UI, DB 조회와 앱 재실행 후에도 다시 나타나지 않는다.

#### Story 5 — 대화형 PRD 개선

> As a product author, I want the AI to interview me one question at a time so
> that the final PRD reflects decisions that were not present in my draft.

Acceptance criteria:

- 시작 시 대상 문서와 제한된 워크스페이스 참고 문맥을 분석한다.
- 화면에는 한 번에 핵심 질문 하나만 표시한다.
- 문서와 이전 답변에서 확인할 수 있는 사실은 사용자에게 다시 묻지 않고, 제품
  의사결정이 필요한 지점만 질문한다.
- 각 질문에는 사용자가 그대로 채택하거나 수정할 수 있는 구체적인 추천 답변을
  표시한다.
- 다음 질문은 이전 질문, 사용자 답변, 대상 문서와 아직 해결되지 않은 PRD 영역을
  반영한다.
- 사용자는 자유 텍스트로 답하고, 답변 수정과 질문 건너뛰기를 할 수 있다.
- 질문 수나 모델의 자체 종료 조건을 두지 않는다.
- 사용자가 `충분합니다`, `enough` 등 종료 의도를 입력하거나
  `Enough — Generate PRD`를 눌렀을 때 종료 확인 후 최종 생성을 시작한다.
- 진행 중 세션은 앱 재실행 후 질문과 답변 손실 없이 이어진다.
- 최종 응답은 기존 PRD finding·operation schema를 통과해야 Review에서 적용할 수
  있다.
- 원문에 없고 사용자가 답하지 않은 사실은 assumption 또는 proposed metric으로
  표시한다.

#### Story 6 — 장문과 워크스페이스 번역

> As a multilingual reviewer, I want long translations to make steady,
> recoverable progress so that one truncated response does not waste the run.

Acceptance criteria:

- Markdown 제목, 문단, 목록, 인용, 표와 코드 fence 경계를 고려해 청크를 만든다.
- 하나의 구조 블록은 가능하면 나누지 않고, 모델 context와 최대 출력 예산 안에
  들어오도록 청크 크기를 결정한다.
- 청크를 순차 실행하고 매 청크마다 응답 schema와 Markdown 보호 구조를 검증한다.
- SSE의 `finish_reason`과 사용량을 기록한다.
- `length` 또는 중간 문자열로 끝난 `invalid_schema`가 감지되면 해당 청크를 더
  작게 나누고 자동 재시도한다.
- `EOF while parsing a string`처럼 JSON string 중간에서 끝난 local validation
  오류는 사용자 실패로 확정하기 전에 response truncation으로 분류한다.
- 자동 세분화 횟수가 한도에 도달하면 완료 청크를 보존하고 실패 청크에서 수동
  재개할 수 있게 한다.
- 취소 시 새 청크를 시작하지 않고 검증된 완료 청크를 재개 정보와 함께 저장한다.
- 모든 청크가 검증된 뒤에만 파일별 결과를 병합해 Review를 연다.
- 워크스페이스 번역 결과는 파일별로 승인 또는 폐기할 수 있다.
- 모델을 자동 전환하지 않으며 사용자가 GLM-5.2 또는 Kimi K3로 재시도한다.

#### Story 7 — 안전한 Review와 적용

> As an editor, I want stale or invalid AI output blocked so that background
> work never overwrites newer writing.

Acceptance criteria:

- 실행 당시 source hash와 현재 source hash가 같은 결과만 원문에 적용할 수 있다.
- source가 바뀐 결과는 적용을 차단하고 재실행 또는 새 문서 열기를 제공한다.
- 전체 적용과 선택 적용은 단일 Undo transaction이다.
- 워크스페이스 batch도 파일별 source hash를 독립적으로 검증한다.
- 일부 파일이 stale이어도 다른 검증 완료 파일의 Review는 유지된다.
- 검증되지 않은 청크와 중간 부분 결과는 문서 적용 대상으로 노출하지 않는다.

#### Story 8 — Obsidian Document Properties

> As an Obsidian user, I want to edit front matter as document properties so
> that WYSIWYG authoring remains compatible with my Markdown vault.

Acceptance criteria:

- 문서 첫 바이트부터 시작하는 `---`와 닫는 `---` 또는 `...`만 front matter로
  인식한다.
- 본문 중간의 `---`는 기존 thematic break 동작을 유지한다.
- 유효한 YAML은 WYSIWYG 본문 위의 접이식 Document Properties 카드로 표시한다.
- 문자열, 숫자, 불리언, 날짜와 scalar 배열은 카드에서 편집할 수 있다.
- Obsidian `[[Wiki Link]]` 문자열과 tag 배열은 chip으로 표시한다.
- 필드를 추가하고 기존 단순 필드를 삭제할 수 있다.
- 복합 map, 중첩 sequence, anchor, alias와 multiline scalar는 Raw YAML 편집을
  제공한다.
- 잘못된 YAML은 원문과 오류 위치를 Raw 모드에 표시하고 속성 폼으로 부분
  변환하지 않는다.
- 카드를 접어도 편집 상태와 원문은 유지된다.

제공된 필수 fixture:

```yaml
---
title: "AI가 코드를 짜주는 시대에, 우리는 왜 개발자를 찾을까요?"
source: "https://medium.com/algocare-career/ai%EA%B0%80-%EC%BD%94%EB%93%9C%EB%A5%BC-%EC%A7%9C%EC%A3%BC%EB%8A%94-%EC%8B%9C%EB%8C%80%EC%97%90-%EC%9A%B0%EB%A6%AC%EB%8A%94-%EC%99%9C-%EA%B0%9C%EB%B0%9C%EC%9E%90%EB%A5%BC-%EC%B0%BE%EC%9D%84%EA%B9%8C%EC%9A%94-492ed7b645aa"
author:
  - "[[Career]]"
published: 2026-07-14
created: 2026-08-01
description: "More"
tags:
  - "clippings"
---
```

#### Story 9 — Front Matter 원문 보존

> As a Markdown author, I want untouched YAML bytes preserved so that editing
> the body cannot create unrelated metadata diffs.

Acceptance criteria:

- 본문만 편집하고 저장하면 front matter 구간은 byte-identical하다.
- 속성 하나를 편집하면 해당 scalar source range와 필요한 YAML syntax만 바뀐다.
- 다른 필드의 순서, key spelling, comments, quotes, Wiki links와 line ending은
  유지된다.
- no-op WYSIWYG 저장은 전체 문서 바이트를 그대로 유지한다.
- YAML field edit 뒤 Source와 WYSIWYG 모드를 오가도 같은 YAML 문서를 유지한다.
- front matter는 outline heading, 문서 word count와 AI 본문 segment로 잘못
  집계되지 않는다.
- 번역에서는 key, URL, 날짜, boolean, 숫자, tag identifier와 Wiki link를
  보호한다. `title`, `description`, `summary`의 자연어 scalar만 번역 대상으로
  허용한다.

### Non-Goals

- 외부 Git 저장소의 skill, shell, tool, subagent 또는 임의 코드를 OpenRouter가
  실행하는 기능
- 전체 워크스페이스 원문을 무제한으로 하나의 prompt에 전송하는 기능
- AI 실행 기록의 cloud sync, 팀 공유 또는 원격 backup
- 사용자 승인 없는 자동 적용, 자동 저장 또는 background 번역
- 서로 다른 모델로의 자동 fallback
- 여러 번역 청크의 병렬 provider 호출
- PDF, DOCX, 이미지, 오디오 또는 Markdown 이외 문서 batch
- 범용 Obsidian plugin API, Dataview query 실행 또는 vault graph 기능
- 모든 YAML schema를 폼으로 표현하는 기능
- 잘못된 YAML의 자동 수정 또는 추측 기반 coercion

## 3. AI System Requirements

### Tool Requirements

OpenRouter 호출은 Rust/Tauri 계층에서만 수행하고 기존 OpenAI-compatible API
계약을 유지한다.

| 목적 | API 또는 도구 | 요구사항 |
| --- | --- | --- |
| 키 보관 | macOS Keychain | 고정 service와 account 사용 |
| 키 검증 | `GET /api/v1/key` | 키 값을 frontend나 log에 반환하지 않음 |
| 모델 목록 | `GET /api/v1/models/user` | GLM-5.2와 Kimi K3 고정 대안 포함 |
| 생성 | `POST /api/v1/chat/completions` | SSE, schema, usage, finish reason |
| 기록 | local SQLite | schema migration, 500개 retention, 20개 page |
| YAML | concrete syntax tree parser | node range와 원본 표기 보존 |

Keychain service는 `dev.chann.markdowner.openrouter`, account는 `default`로
고정한다.

모든 AI 요청은 기본적으로 `provider.zdr: true`와
`provider.require_parameters: true`를 유지한다. 사용자가 ZDR을 끌 때에는 provider
정책에 따라 입력과 출력이 보관될 수 있음을 명시한다. 자격 있는 endpoint가 없으면
설정을 조용히 완화하지 않는다.

### Curated Prompt Recipes

OpenRouter는 외부 저장소의 agent skill을 직접 설치하거나 실행하지 않는다.
Markdowner가 검토된 방법론을 host workflow로 구현하고 대화 상태를 매 요청에
명시적으로 포함한다.

- [obra/superpowers](https://github.com/obra/superpowers)의 brainstorming에서
  한 번에 하나의 질문, 대안 비교, 단계별 승인 방식을 채택한다.
- [mattpocock/skills의 grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)가
  호출하는
  [grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md)에서
  의사결정 트리를 한 번에 한 질문씩 내려가는 방식, 질문마다 추천 답변을 제시하는
  방식, 문서에서 확인할 수 있는 사실 대신 사용자 의사결정을 묻는 방식을 채택한다.
- prompt recipe는 앱 source에 versioned constant 또는 asset으로 포함한다.
- 임의 로컬 Markdown 파일이나 내려받은 skill을 자동 system prompt로 실행하지
  않는다.
- 각 실행 기록에는 prompt recipe version을 저장해 결과 재현과 회귀 평가에
  사용한다.

### PRD Interview Contract

각 인터뷰 요청은 누적 상태를 전달하고 다음 구조를 반환한다.

```text
schema_version
session_id
next_question { id, text, rationale, unresolved_area }
resolved_decisions[]
remaining_areas[]
warnings[]
```

최종 생성 요청만 기존 PRD response schema를 반환한다.

```text
schema_version
summary
findings[] { id, severity, category, evidence_segment_id, rationale }
operations[] { id, kind, target_segment_id, markdown, finding_ids[] }
assumptions[]
```

모델이 `remaining_areas`를 비워도 앱은 인터뷰를 자동 종료하지 않는다. 사용자의
명시적 종료가 최종 생성의 유일한 trigger다.

### Translation Chunk Contract

1. source를 leading front matter, heading section과 Markdown block으로 분석한다.
2. 보호 token을 삽입한 segment들을 모델별 입력·출력 budget에 맞춰 청크로 묶는다.
3. 한 번에 한 청크를 실행하고 `finish_reason`, usage와 generation ID를 기록한다.
4. 응답 schema와 segment·보호 token을 로컬에서 검증한다.
5. 출력 한도 또는 잘린 JSON이면 청크를 더 작은 block 그룹으로 분해해 재시도한다.
6. 검증된 청크만 resume store에 저장한다.
7. 전체 검증 후 원래 segment 순서로 재구성하고 문서 단위 validator를 다시 실행한다.

OpenRouter response healing은 streaming과 `max_tokens`로 잘린 응답을 복구하는
수단으로 사용하지 않는다. 구조 인식 분할과 `finish_reason` 기반 재시도가 기본
복구 경로다.

### Workspace Context Policy

- PRD와 자유 프롬프트는 워크스페이스 전체 파일 내용을 그대로 보내지 않는다.
- 현재 문서 외에는 상대 경로, heading manifest와 relevance가 높은 제한된 발췌만
  포함한다.
- ignore list, 숨김 파일 정책과 읽기 실패를 기존 workspace scanner와 동일하게
  적용한다.
- 실행 전 참고 대상 문서 목록과 estimated token을 사용자가 확인할 수 있다.
- context snapshot의 파일별 hash를 기록해 결과 diagnostics에 사용한다.

### Evaluation Strategy

#### Deterministic Contract Tests

- scheduler: 앱 2개, 문서 1개 제한, cancel, interrupted recovery
- SQLite: migration, status transition, 500개 pruning, 20개 page, delete
- chunking: heading, table, list, fence, oversized block와 UTF-8 boundary
- truncation: `finish_reason=length`, EOF JSON, recursive subdivision와 resume
- Markdown: protected token, front matter key/value policy, whole-document merge
- WYSIWYG: valid, invalid, complex YAML, Wiki link, CRLF와 no-op byte preservation
- shell: button, shortcut, Palette와 shortcut help의 shared action

#### AI Quality Evaluation

- 기존 PRD 30개 benchmark에 인터뷰 전후 결과를 추가해 finding recall과 전문가
  유용성을 비교한다.
- 40개 다국어 fixture와 20개 장문 fixture에서 의미 보존, 구조 보존, 청크 경계
  일관성을 평가한다.
- GLM-5.2와 Kimi K3를 같은 frozen fixture, temperature와 prompt version으로
  평가하되 모델별 결과를 별도 보고한다.
- provider network evaluation은 deterministic CI와 분리하고 API 키가 있는 수동
  release gate에서 실행한다.

## 4. Technical Specifications

### Architecture Overview

```text
Activity Bar / ⌘⇧A / Command Palette
                 │
                 ▼
        React AI Feature sidebar
  New ───── Activity ───── History
    │            │             │
    └──────── Tauri commands/events ───────┐
                                           ▼
                              Rust AiRuntime
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
          Scheduler       Orchestrators   HistoryStore
         in-memory       PRD / Translate     SQLite
                └──────────────┬──────────────┘
                               ▼
                        OpenRouter client
                               │
                               ▼
                    local validation / Review
```

`AiRuntime`는 기존 scheduler, OpenRouter client, active registry와 persistent
HistoryStore를 소유한다. React는 backend snapshot과 event를 표현하며 별도의 실행
정본을 만들지 않는다.

WYSIWYG front matter는 AI runtime과 독립된 editor extension이다.

```text
Markdown source
      │
      ├─ split leading front matter ─ YAML source model ─ Property Node View
      │                                               └─ Raw YAML fallback
      └─ body ─ @tiptap/markdown ─ ProseMirror document
                         │
                         └─ serialize body + preserved or patched YAML bytes
```

### Runtime State Model

Active request snapshot:

```text
request_id
task
scope { kind, target_document, workspace_root, file_count }
model
status { queued, running, cancelling }
stage
file_progress { completed, total, current_path }
chunk_progress { completed, total, current_heading }
started_at
cancelable
```

Terminal history status:

```text
completed | failed | cancelled | interrupted
```

상태 전이는 backend에서만 발생한다. frontend는 request ID 기준으로 event를
병합하고 앱 포커스 또는 sidebar mount 여부와 무관하게 최신 snapshot을 다시
조회할 수 있다.

### SQLite Persistence

DB 위치는 Tauri app data directory 아래 `ai/history.sqlite3`이다. schema migration을
application startup에서 transaction으로 실행한다.

주요 logical table:

| Table | 책임 |
| --- | --- |
| `ai_runs` | 실행 metadata, source hash, result, error, usage |
| `ai_interview_turns` | run별 question, answer, 순서, 수정·skip 상태 |
| `ai_translation_chunks` | file·chunk, source hash, result, resume 상태 |
| `ai_schema_migrations` | 적용된 schema version |

원문 전체는 `ai_runs`나 chunk row에 저장하지 않는다. 검증된 AI 결과와 사용자가
작성한 인터뷰 답변은 상세 history 요구사항에 따라 저장한다. result와 error JSON은
schema version을 포함한다.

완료 상태를 기록하는 transaction에서 500개를 넘는 가장 오래된 terminal run과
그 child row를 삭제한다. 진행 중 인터뷰는 terminal retention보다 우선하며 사용자
삭제 또는 종료 전에는 자동 prune하지 않는다.

### Tauri Integration Points

기존 command를 호환 가능한 범위에서 확장하고 다음 read model을 제공한다.

```text
ai_run
ai_cancel
ai_list_active
ai_history_page
ai_history_detail
ai_history_delete
ai_history_clear
ai_interview_start
ai_interview_answer
ai_interview_finish
ai_run_resume
```

긴 실행은 IPC channel로 세부 stream event를 보내고 app-wide Tauri event로 active
snapshot invalidation을 알린다. sidebar가 열려 있지 않아도 backend 실행은
유지된다.

### Front Matter Editor Contract

- parser는 source의 선두 delimiter와 closing delimiter source range를 먼저
  분리한다.
- YAML concrete syntax tree는 raw source, line ending과 node range를 보유한다.
- 단순 field edit은 target scalar range만 patch하고 전체 YAML을 재출력하지 않는다.
- field 추가·삭제처럼 구조 변경이 필요한 경우 CST가 보존할 수 있는 comment와
  order를 유지해 최소 범위만 다시 출력한다.
- `frontMatter` Tiptap node는 body document의 첫 block이며 raw YAML과 parse status를
  attribute로 가진다.
- React Node View는 Property Card와 Raw YAML mode를 렌더링한다.
- editor Markdown serializer는 node의 raw 또는 patched source를 body 앞에 그대로
  결합한다.
- cursor offset 변환, find, copy, paste, outline과 document stats는 front matter
  source range를 명시적으로 처리한다.

### Settings and Command Integration

Settings navigation에 독립된 `AI Feature` 항목을 추가한다.

1. **OpenRouter Connection**: Keychain status, verify, replace, delete
2. **Task Defaults**: GLM-5.2 기본, Kimi K3 가용, task별 모델, 기본 언어와 범위
3. **History & Privacy**: 상세 로컬 기록, 500개 retention 설명, clear history,
   ZDR routing

`toggleAiFeature` action 하나를 Activity Bar, keydown handler, Command Palette와
shortcut registry가 공유한다. 테스트는 네 표면의 label, key와 상태 결과가 같은지
검증한다.

### Security and Privacy

- API key와 Authorization header는 Keychain 밖에 저장하거나 log하지 않는다.
- workspace scope는 실행 전 실제 전송 대상과 estimated token을 보여준다.
- AI history는 local-only이며 cloud sync와 analytics 대상이 아니다.
- 문서 원문, filename, prompt, answer, AI result를 analytics event에 포함하지 않는다.
- raw diagnostic은 credential과 source excerpt를 redact한 뒤 명시적으로 펼칠 때만
  보인다.
- SQLite 파일은 사용자 계정 권한의 app data directory에 두며 앱 UI에서 삭제할
  수 있다.
- prompt injection 문자열은 문서 데이터로 취급하고 tool 또는 command surface를
  모델에 제공하지 않는다.

### Error Handling

| 상황 | 사용자 동작 |
| --- | --- |
| API key 없음·무효 | Settings의 OpenRouter Connection으로 이동 |
| model unavailable | GLM-5.2 또는 Kimi K3를 사용자가 다시 선택 |
| provider rate limit | retry 가능 시각과 completed chunk 유지 |
| response truncation 또는 JSON EOF | 현재 청크 자동 세분화 후 재시도 |
| schema validation 실패 | 안전한 요약과 접힌 redacted diagnostic 표시 |
| source 변경 | 적용 차단, 재실행 또는 새 문서 열기 |
| app crash | terminal run을 Interrupted로 복구, resume 가능한 세션 유지 |
| invalid YAML | Raw YAML과 오류 위치 표시, body와 raw source 보존 |
| DB migration 실패 | AI 기록 기능을 read-only 또는 unavailable로 격리하고 편집기 계속 사용 |

## 5. Risks & Roadmap

### Phased Rollout

모든 단계는 하나의 v2 release에 포함하되 검증 가능한 commit checkpoint로 나눈다.

1. **Foundation**: SQLite schema, runtime state, migration과 history contracts
2. **Navigation**: AI Feature 명칭, tabs, `⌘⇧A`, Palette와 shortcut help
3. **Activity and History**: app-wide progress, cancel, pagination, delete, interruption
4. **PRD Interview**: curated recipe, persistent turns, explicit finish, final Review
5. **Resilient Translation**: heading-aware chunks, finish reason, subdivision,
   resume와 workspace batch
6. **Front Matter**: YAML source model, Property Card, Raw fallback, exact round-trip
7. **Release Gate**: full tests, build, runtime UI verification, Headatever patch와
   tag push

각 checkpoint는 관련 test, typecheck 또는 build를 통과한 뒤 Conventional Commit으로
즉시 push한다. release checkpoint는 전체 요구사항이 검증된 뒤에만 수행한다.

### Technical Risks and Mitigations

#### SQLite dependency and migration failure

- 위험: 새 native dependency가 universal build 크기와 migration 복잡도를 늘린다.
- 완화: 최소 feature의 bundled SQLite를 사용하고 temp DB migration·rollback test,
  app startup degradation path와 schema version을 둔다.

#### Workspace context cost and privacy

- 위험: 많은 파일이 비용을 높이거나 사용자가 예상하지 않은 내용을 전송한다.
- 완화: ignore policy, bounded manifest·excerpt, 실행 전 파일 목록과 비용 확인,
  50,000 token hard limit을 적용한다.

#### Translation retry explosion

- 위험: 지나친 세분화와 재시도가 비용과 대기 시간을 늘린다.
- 완화: 청크별 retry·subdivision 상한, 비용 갱신, 사용자 재개와 모델 수동 변경을
  제공한다.

#### Stale multi-file results

- 위험: batch 실행 중 사용자가 일부 파일을 수정할 수 있다.
- 완화: 파일별 source hash, 독립 Review와 stale 적용 차단을 사용한다.

#### YAML corruption

- 위험: 일반 serializer가 quote, comment, type 또는 Wiki link를 정규화할 수 있다.
- 완화: raw source와 CST range를 함께 보존하고 target range patch, invalid raw-only
  fallback과 byte fixture를 release gate로 둔다.

#### Provider schema variance

- 위험: 모델 또는 provider가 structured output과 finish reason 계약을 다르게
  구현할 수 있다.
- 완화: provider parameter requirement, local validator, frozen SSE fixture와
  모델별 evaluation을 유지한다.

### Release Readiness Checklist

- PRD의 모든 acceptance criteria가 test 또는 수동 proof와 연결되어 있다.
- 전체 Rust workspace test, Clippy와 formatting이 통과한다.
- frontend unit·integration test, TypeScript, lint와 production build가 통과한다.
- 실제 앱에서 `⌘⇧A`, Command Palette, shortcut help, 세 탭과 Settings를 확인한다.
- 제공된 Obsidian fixture를 열고 property edit, body edit, Source 왕복과 저장 파일
  byte diff를 확인한다.
- 실제 OpenRouter key가 가능한 환경에서는 GLM-5.2 장문 번역과 PRD 인터뷰를
  실행한다. 키가 없으면 해당 network proof를 미검증으로 명시한다.
- Git worktree가 깨끗하고 `HEAD...@{upstream}`이 `0 0`이다.
- Headatever dry-run 결과를 확인한 뒤 patch commit과 annotated tag를 push한다.

### Open Questions

없음. 본 문서의 Fixed Product Decisions와 세 차례 통합 설계 승인이 구현 기준이다.
