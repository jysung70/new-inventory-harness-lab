# 03. 구현·검증 루프

> 이 문서는 `02-verification.md`가 내린 검증 판정 **이후**의 절차를 정의한다.
> `02`는 현재 checkout/commit의 검증과 `PASS`/`FAIL` 판정만 담당하고,
> 이 문서는 판정 이후의 반복·사람 판단·PR·CI·Review·종료를 담당한다.

`docs/harness/01-ssot.md`에 등록된 구현·검증 루프의 원본이다.

---

## 1. 책임 경계

### `02-verification.md`

- 정의된 순서로 검증 단계를 실행한다.
- 첫 실패 단계와 원인을 판정한다.
- `PASS` 또는 `FAIL` 결과와 검증 증거를 만든다.
- 검증 규칙을 바꾸지 않고, 이후 행동을 결정하지 않는다.

공식 판정 명령은 다음 하나다.

```bash
npm run verify
```

### `03-loop.md`

- 02 결과를 받아 다음 행동을 결정한다.
- 구현 시도와 최대 횟수를 관리한다.
- 실패를 분류하고 재시도 또는 `NEEDS_HUMAN`을 결정한다.
- 세션 중단·재개와 Issue/PR/commit/CI 증거를 연결한다.
- PR 진입, CI 결과, Review·Merge 전 상태를 관리한다.

03은 02의 검증 단계를 복제하지 않는다.

---

## 2. 상태 머신

```text
READY → IN_PROGRESS → VERIFYING
                         ↓ 02 판정
            ┌────────────┼────────────┐
            ↓            ↓            ↓
         PASSED   RETRYABLE_FAILURE NEEDS_HUMAN
            ↓            ↓
  READY_FOR_REVIEW   (남은 시도 확인)
            ↓            ↓
      READY_FOR_PR  IN_PROGRESS
            ↓
         PR_OPEN
            ↓
       CI_PENDING → CI_RUNNING
                       ├─ CI_PASSED → HUMAN_REVIEW → READY_FOR_MERGE → MERGED
                       ├─ CI_FAILED → 로컬 재현
                       │              ├─ 동일 실패 → IN_PROGRESS
                       │              └─ 미재현 → NEEDS_HUMAN
                       └─ CI_CANCELLED → 재실행 또는 NEEDS_HUMAN
```

상태 목록:

```text
READY, IN_PROGRESS, VERIFYING
PASSED, RETRYABLE_FAILURE, RETRY_EXHAUSTED
NEEDS_HUMAN, HUMAN_APPROVED, HUMAN_REJECTED, RESUME_REQUESTED
READY_FOR_REVIEW, READY_FOR_PR, PR_OPEN
CI_PENDING, CI_RUNNING, CI_PASSED, CI_FAILED, CI_CANCELLED
HUMAN_REVIEW, CHANGES_REQUESTED, READY_FOR_MERGE
MERGED, REJECTED, ABANDONED
```

상태 전이는 원장에 이전 상태·새 상태·주체·시각·head SHA·근거·다음 행동을 기록한다.
정의되지 않은 전이, 모순된 원장, 다른 head의 증거는 자동으로 처리하지 않고
`NEEDS_HUMAN`으로 멈춘다.

---

## 3. 구현 시도와 횟수

시도 1회는 다음 묶음이다.

```text
구현 변경 → 해당 변경의 정확한 head에서 02 판정 기록
```

- 초기 구현과 첫 02 판정은 attempt 1이다.
- `maxAttempts`는 Issue의 `max-loops`에서 읽어 작업 시작 시 고정한다.
- 02 판정이 영속적으로 기록된 경우에만 `consumedAttempts`를 1 증가시킨다.
- 같은 head의 02 재실행·CI 실행·CI 재실행·polling·취소·로그 수집·로컬 재현은 시도가 아니다.
- 세션 변경은 카운터를 초기화하지 않는다.
- `consumedAttempts >= maxAttempts`이면 `RETRY_EXHAUSTED`를 거쳐 `NEEDS_HUMAN`에서 멈춘다.
- 02 판정 전에 세션이 중단되면 열린 attempt를 우선 재개하며 시도를 소비하지 않는다.

기계적이고 명확하며 현재 변경에 귀속되는 실패만 남은 횟수 안에서 반복한다.
Protected, SSOT/Issue 충돌, 요구사항·아키텍처·스키마·범위 변경, flaky·모호한 실패,
환경 실패, max-loops 누락, Review·Merge 판단은 사람에게 넘긴다.

---

## 4. PR 진입 게이트

다음 세 조건이 **동일한 candidate head SHA**에 대해 모두 기록되어야 `READY_FOR_PR`로 이동한다.

1. 로컬 `npm run verify`가 `PASS`했다.
2. Issue의 모든 종료 조건이 충족되었다.
   - 전용 테스트와 필요한 사람 증거가 있다.
   - max-loops와 attempt 원장이 유효하다.
   - 승인되지 않은 Protected 변경이 없다.
3. 사람이 완료 코멘트를 작성했다.
   - Issue, branch, candidate head SHA
   - 로컬 verify 결과와 실행 식별자
   - 종료 조건 증거 요약
   - 현재/최대 시도
   - 다음 행동(PR 생성 또는 기존 PR 연결)

하나라도 빠졌거나 다른 head에 속하면 PR 진입을 허용하지 않는다.
완료 코멘트는 Review·Merge 승인이나 Issue 종료가 아니다.

```text
PASSED → READY_FOR_REVIEW → READY_FOR_PR
```

PR 생성·push·메타데이터 변경은 명시적인 외부 작업이다. loop가 소스 수정 중 암묵적으로
실행하지 않는다. 일치하는 기존 PR만 연결하고, 다른 branch/head의 PR은 중복 생성하지 않고
`NEEDS_HUMAN`으로 멈춘다.

---

## 5. CI 진입과 시도 횟수

PR이 연결되면 기존 `.github/workflows/verify.yml`의 PR 이벤트로 CI가 실행된다.
03은 `npm run verify`의 판정 규칙을 복제하거나 변경하지 않는다.

```text
PR_OPEN → CI_PENDING → CI_RUNNING
```

각 CI 이벤트는 PR 번호/URL, branch, base/head SHA, workflow/run ID, rerun ID, 상태,
첫 실패 단계, 로그 참조, 환경, superseded 여부를 원장에 기록한다.

**CI 최초 실행, 재실행, polling, 취소, 로그 수집, 로컬 재현 확인은 구현 시도 횟수를
증가시키지 않는다.** CI 실패 후 실제 구현 변경과 그 변경에 대한 새 02 판정이 완료될 때만
기존 attempt 규칙에 따라 새 시도를 소비한다.

현재 PR head와 동일한 head의 CI `PASS`만 유효하다. 이전 head의 결과는 stale이다.

---

## 6. CI 실패 후 복귀

CI 실패는 같은 head와 가능한 한 동등한 환경에서 로컬로 먼저 재현한다.
“재현됨”은 CI와 같은 관련 02 단계와 귀속 가능한 원인이 로컬에서도 실패한다는 뜻이다.
로컬 `PASS`는 재현되지 않은 것이다.

```text
CI_FAILED
  → CI 증거 기록
  → 같은 head로 로컬 재현
  ├─ 같은 단계·원인이 재현됨
  │    → 기존 구현·02 루프로 복귀
  │    → 명시적 구현 변경
  │    → 새 head의 02 판정
  ├─ 로컬 PASS / 미재현
  │    → NEEDS_HUMAN
  └─ 동등한 환경을 만들 수 없음
       → NEEDS_HUMAN
```

재현되었더라도 Protected, 충돌, 범위·설계 변경, flaky·환경 실패 또는 모호한 실패면
자동 반복하지 않는다. CI 실패 자체는 시도를 소비하지 않는다.

CI가 취소되면 `CI_CANCELLED`로 기록하고 성공으로 취급하지 않는다. 현재 head가 그대로면
재실행을 기다릴 수 있지만, head가 바뀌었으면 이전 CI 증거는 폐기하고 PR 진입 게이트부터
다시 확인한다.

---

## 7. CI 성공·Review·Merge

```text
CI_PASSED (current head)
  → HUMAN_REVIEW
  → READY_FOR_MERGE
  → 사람의 Merge
  → MERGED
```

CI `PASS`만으로 Review·Merge·Issue close를 수행하지 않는다. 사람의 Review와 Merge가
필수이며, 실제 Merge 이후에만 `MERGED`를 기록한다.

`READY_FOR_MERGE`에는 다음이 모두 필요하다.

- 현재 PR head와 일치하는 CI `PASS`
- Issue 종료 조건과 전용 테스트 증거
- 시도 원장 완결
- 사람 Review 완료와 요청 변경 처리
- 승인되지 않은 Protected 변경 없음

---

## 8. Durable Issue/PR 원장

작업 원장은 GitHub Issue의 구조화된 append-only 기록으로 보존한다. PR은 구현·Review·CI
증거를 연결하는 위치다. 대화 세션 메모리나 `verify.db`에만 상태를 두지 않는다.

최소 필드:

```yaml
schemaVersion: 1
repository:
issue:
pr:
branch:
baseSha:
headSha:
loopState:
maxAttempts:
consumedAttempts:
currentAttempt:
  number:
  status: open | judged | interrupted | abandoned
attempts: []
verification:
  runId:
  result: PASS | FAIL | CANCELLED
  firstFailingStage:
  summary:
prEntry:
  candidateHeadSha:
  localVerifyRunId:
  issueConditionsComplete:
  completionCommentId:
ciRuns: []
session:
  agent:
  sessionId:
  updatedAt:
humanDecision:
  status:
  actor:
  timestamp:
  reason:
nextAction:
```

각 attempt와 CI 실행에는 head SHA를 넣는다. 원장에는 과거 시도와 CI 결과를 지우지 않는다.
원장 누락·중복·손상, Issue/PR/Git 상태 불일치, 활성 다른 claim은 `NEEDS_HUMAN`이다.

---

## 9. 세션 시작·재개

새 에이전트는 수정 전에 다음을 확인한다.

```bash
git fetch --all --prune
git status --short --branch
git branch -vv
git worktree list
git log --oneline --decorate -n 10
gh issue view <issue> --repo <repo>
gh pr view <pr> --repo <repo>
```

그 뒤 원장의 Issue/PR, branch, base/head SHA, dirty 상태, claim, loopState,
consumed/max attempts, 마지막 02·CI 결과, 사람 판단, nextAction을 요약한다.

- 원장 head와 현재 head가 다르면 수정하지 않는다.
- 완료 코멘트·로컬 PASS·CI PASS가 현재 head와 다르면 stale 처리한다.
- 02 판정 전 열린 attempt는 우선 재개한다.
- 열린 attempt를 폐기하거나 새 번호를 주는 것은 사람의 결정이다.
- 복구할 수 없는 상태는 추측하지 않고 `NEEDS_HUMAN`이다.
- 세션 변경은 attempt 카운터를 초기화하지 않는다.

동일 Issue/PR에는 열린 구현 claim 하나만 허용한다. 다른 claim이 있으면 자동 수정하지 않는다.

---

## 10. 사람 개입 체크리스트

사람의 명시적 판단이 필요한 경우:

- Protected 경로 승인 또는 되돌림
- Issue ↔ SSOT 또는 SSOT ↔ SSOT 충돌
- 요구사항·아키텍처·스키마·범위 변경
- max-loops 누락·재설정·초과
- 모호·flaky·환경 실패
- CI 실패 미재현 또는 환경 비동등
- 열린 attempt 폐기와 동시 claim 충돌
- 완료 코멘트 확인과 PR 생성·push
- Review·Merge·Issue close

사람에게는 사건, 파일·head·검증 단계, 현재/최대 attempt, 근거, 선택지를 함께 제시한다.
사람의 응답 없이 에이전트는 승인·범위·Merge를 추측하지 않는다.

---

## 11. 완료 증거와 기계 검증

`READY_FOR_REVIEW`와 `READY_FOR_PR` 전에 다음을 기계적으로 확인한다.

- Issue와 max-loops가 유효하다.
- 전용 테스트 경로가 존재하고 삭제되지 않았다.
- 종료 조건별 테스트 또는 사람 증거가 기록되어 있다.
- 최종 head의 02 `PASS`가 기록되어 있다.
- 완료 코멘트가 같은 head를 가리킨다.
- Protected 변경이 승인되어 있다.
- PR의 base/head가 원장과 같다.

기계가 자연어 종료 조건의 의미를 증명할 수 없으면 증거 부족으로 `NEEDS_HUMAN`이다.

---

## 12. 정책 변경

이 문서의 규칙은 사람이 요청한 경우에만 바꾼다. 규칙 변경은 이 문서와 관련 원본의
승인 절차를 따른다. 02 검증 규칙은 `docs/harness/02-verification.md`, 도메인은
`docs/01-requirements.md`, 구조는 `docs/06-architecture.md`가 원본이다.

이 문서가 정하지 않은 구현·운영 방법을 임의로 추가하지 않는다.
