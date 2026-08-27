<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 이 저장소에서 일하는 방법

**작업을 시작할 때 문서를 전부 읽지 않는다.**
§1에서 질문 유형에 맞는 원본 **하나**를 골라 그것만 읽고 시작한다.
그 원본으로 판단이 서지 않을 때만 §3의 순서대로 범위를 넓힌다.

무엇이 원본인지에 대한 정본은 [`docs/harness/01-ssot.md`](docs/harness/01-ssot.md) 이다.
아래 내용과 SSOT가 어긋나면 SSOT가 맞다.

**원본끼리, 또는 Issue와 원본이 어긋나면 어느 쪽이 맞는지 스스로 고르지 않는다.**
`NEEDS_HUMAN`을 선언하고 사람의 판단을 받는다. 처리 규칙은 SSOT §4다.

---

## 1. 라우팅 — 질문 유형별로 읽을 원본

| 질문이 이런 것이면                                                                 | 이것만 읽는다                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 로트란 무엇인가 · 거점 종류 · 재고 증감 사유 · **FEFO/LEFO 방향** · 기능 요구 · 완료 기준 · 이게 범위 안인가 | `docs/01-requirements.md`                                                |
| 코드가 어떻게 나뉘어 있나 · `applyMovement` 같은 핵심 로직 · 왜 이 구조인가 · 인증 · 시드 설계 · 동시성    | `docs/06-architecture.md`                                                |
| 지금 이 작업의 범위와 완료 조건                                                         | 해당 GitHub Issue                                                          |
| 무엇을 통과해야 검증된 것인가 · 어떤 검사가 도는가                                            | `docs/harness/02-verification.md` (검사 실행: `npm run verify`)              |
| 검증 판정 뒤 무엇을 하는가 · 시도 횟수 · 재시도 · 세션 재개 · 사람 판단 · Issue/PR 루프 | `docs/harness/03-loop.md` (판정은 `docs/harness/02-verification.md`)             |


두 줄에 걸치는 질문이면 **위쪽부터** 읽는다. 도메인 규칙이 구현 구조보다 앞선다.

맨 아래 배경 문서 3종은 원본이 아니다. 흐름과 의도를 이해할 때만 쓰고,
거기 적힌 규칙이 `docs/01-requirements.md`와 다르면 요구사항 쪽이 맞다.

---

## 2. 원본이 없는 영역 — 지어내지 않는다

03-loop에 정의된 구현·검증 루프는 이 영역에서 더 이상 원본이 없다거나 정해진 바 없다고 보지 않는다.
다만 03-loop가 정하지 않은 영역은 임의로 지어내지 않고 §3의 순서대로 범위를 넓힌다.

---

## 3. 라우팅된 원본으로 안 될 때만 — 넓히는 순서

1. 그 원본이 **명시적으로 가리키는** 인접 원본 (영역 경계는 SSOT §3)
2. 관련 **코드** — 어느 파일인지는 `docs/HANDOVER.md` §6 파일 지도
3. 그래도 답이 없으면 **사용자에게 묻는다**

한 단계에서 답이 나오면 멈춘다. 다음 단계로 넘어가기 전에,
지금 읽은 것으로 정말 답할 수 없는지 한 번 확인한다.

---

## 4. 사본으로 결론 내지 않는다

아래는 원본이 아니다. 원본과 다르면 원본이 맞고, 고칠 대상은 사본이다.

| 사본 | 원본 |
|---|---|
| `README.md`의 FEFO/LEFO 설명 | `docs/01-requirements.md` |
| `docs/03-scenarios.md`의 로트 선택 전략 | `docs/01-requirements.md` |
| `docs/07-plan.md`의 범위 제외 목록 | `docs/01-requirements.md` |
| `docs/06-architecture.md`의 데이터 모델 설명 | `prisma/schema.prisma` |
| `docs/HANDOVER.md` 전체 | 각 영역의 원본 (특정 시점 스냅샷이다) |

---

## 5. 원본을 바꿀 때

규칙이나 구조가 새로 정해지면 **원본을 먼저 고친다.**
Issue 코멘트·PR 설명·이 파일에만 남은 결정은 원본이 아니다.
사본이 같은 내용을 담고 있으면 같은 커밋에서 맞춘다.

**단, 원본을 고치는 것은 사람이 요청할 때다.** AI가 스스로 원본을 갱신하지 않는다 (SSOT §6).
