# 03. 구현·검증 루프 — 초안

> 이 문서는 `02-verification.md`가 내린 검증 **판정 이후**에 무엇을 할지 정의하는 초안이다.
>
> `02-verification.md`는 현재 checkout/커밋이 검증 규칙을 통과했는지만 판정한다.
> 이 문서는 그 판정에 따라 반복할지, 사람에게 넘길지, 작업을 끝낼지를 정한다.
>
> **초안 상태:** 이 파일은 아직 `docs/harness/01-ssot.md`의 원본 등록부에 등록되지 않았다.
> 사람의 검토와 승인 뒤에 정본으로 등록한다.


## 3. 상태와 전이

### 3.1 상태 목록

| 상태 | 의미 | 다음 행동 |
|---|---|---|
| `READY` | Issue와 최대 시도가 확인됐고 작업을 시작할 수 있음 | 작업 claim 후 `IN_PROGRESS` |
| `IN_PROGRESS` | 에이전트가 해당 시도를 구현 중 | 구현 후 `VERIFYING` |
| `VERIFYING` | 정확한 head에 대해 02 실행 중 | 02 결과 기록 |
| `PASSED` | 02가 통과함 | 완료 증거 확인 후 `READY_FOR_REVIEW` |
| `RETRYABLE_FAILURE` | 명확한 기계적 실패이며 남은 시도가 있음 | 새 구현 시도 |
| `RETRY_EXHAUSTED` | 최대 시도를 모두 소비함 | `NEEDS_HUMAN` |
| `NEEDS_HUMAN` | 사람의 판단 없이는 진행할 수 없음 | 사람 결정 기록 후 허용된 상태로 이동 |
| `READY_FOR_REVIEW` | 구현과 02 판정이 완료됨 | 사람 Review |
| `CHANGES_REQUESTED` | Review에서 수정이 요청됨 | 남은 예산 안에서 `IN_PROGRESS` |
| `READY_FOR_MERGE` | Review와 필수 검사가 완료됨 | 사람의 Merge 결정 |
| `MERGED` | PR이 Merge됨 | 작업 종료 |
| `ABANDONED` | 사람이 작업을 중단함 | 종료 |

### 3.2 전이 규칙

```text
READY → IN_PROGRESS
IN_PROGRESS → VERIFYING
VERIFYING → PASSED
VERIFYING → RETRYABLE_FAILURE
VERIFYING → NEEDS_HUMAN
RETRYABLE_FAILURE → IN_PROGRESS
RETRYABLE_FAILURE → RETRY_EXHAUSTED
RETRY_EXHAUSTED → NEEDS_HUMAN
PASSED → READY_FOR_REVIEW
READY_FOR_REVIEW → CHANGES_REQUESTED
READY_FOR_REVIEW → READY_FOR_MERGE
CHANGES_REQUESTED → IN_PROGRESS
NEEDS_HUMAN → IN_PROGRESS       (사람이 재개를 명시한 경우)
NEEDS_HUMAN → READY             (사람이 새 루프로 시작하게 한 경우)
READY_FOR_MERGE → MERGED        (사람의 Merge 후)
모든 상태 → ABANDONED           (사람이 중단한 경우)
```

각 전이는 원장에 다음을 남긴다.

- 이전 상태와 새 상태
- 전이 주체 (`agent`, `02`, `CI`, `human`)
- 전이 시각
- 근거가 되는 head SHA와 02 결과
- 다음 행동

허용되지 않은 전이, 현재 head와 원장의 head 불일치, 서로 다른 열린 claim은 자동으로 진행하지 않는다.

---

## 4. 시도 횟수

### 4.1 시도의 정의

시도 1회는 다음 묶음이다.

```text
구현 변경 발생 → 그 변경의 정확한 head에 대해 02 판정 기록
```

다음은 새 구현 시도가 아니다.

- 변경하지 않은 동일 head에 대한 `npm run verify` 재실행
- 같은 head의 CI 재실행
- 실패 로그 확인
- 새 에이전트 세션이 상태를 읽는 것
- 검증 전용 DB를 새로 준비하는 것

다음은 새 구현 시도다.

- 구현 변경으로 새로운 head가 생김
- 그 head에 대해 새로운 02 판정이 기록됨

CI 재실행은 같은 head에 대한 증거 재실행으로 기록하고 구현 시도를 소비하지 않는다.

### 4.2 최대 횟수

`maxAttempts`는 Issue 양식의 `max-loops`에서 작업 시작 시 한 번 확정한다.

- 값이 없거나 허용 목록 밖이면 `READY`에서 진행하지 않고 `NEEDS_HUMAN`으로 보낸다.
- 확정한 값은 원장에 복사하고, 세션이 바뀌어도 다시 계산해 덮어쓰지 않는다.
- `consumedAttempts`는 02 판정이 기록된 시도만 센다.
- 동일 head의 02 재실행은 `verification rerun`으로 기록하고 카운터를 증가시키지 않는다.

재시도 전에 다음을 확인한다.

```text
remaining = maxAttempts - consumedAttempts
```

- `remaining > 0`이고 실패가 재시도 가능한 기계적 실패면 한 번 반복한다.
- `remaining = 0`이면 즉시 `RETRY_EXHAUSTED`로 전이한 뒤 `NEEDS_HUMAN`으로 멈춘다.
- 사람의 명시적인 결정 없이 최대값을 늘리거나 카운터를 초기화하지 않는다.

### 4.3 시도 기록 예시

```text
attempt 1: started → 02 FAIL(Test) → consumed
attempt 2: started → session interrupted before 02 → not consumed
attempt 2: resumed → 02 PASS → consumed
```

세션 중단으로 열린 시도를 폐기하고 새 번호를 부여하려면 사람의 결정이 필요하다.

---

## 5. 실패 분류와 반복

### 5.1 자동 반복 가능한 실패

다음 조건을 모두 만족할 때만 자동 반복을 제안한다.

- 02의 실패 단계와 출력이 기록되어 있다.
- 실패가 재현된다.
- 원인이 현재 구현 변경으로 좁혀진다.
- 수정 범위가 Issue와 기존 원본 안에서 명확하다.
- 남은 시도가 있다.

예시:

- 변경 코드에서 발생한 결정적인 TypeScript 오류
- 변경 코드에서 발생한 결정적인 lint 오류
- Issue와 원본 규칙으로 기대 결과가 이미 정해진 결정적인 테스트 실패
- 현재 변경에 직접 기인한 import/build 오류

자동 반복은 다음 순서를 따른다.

```text
02 FAIL
  → 실패 증거 기록
  → 기계적 실패로 분류
  → 남은 횟수 확인
  → IN_PROGRESS
  → 범위 안에서 수정
  → 02 재실행
```

03은 `npm run verify`의 검사 규칙을 바꾸거나, 실패를 숨기거나, 테스트를 기대 결과에 맞춰 약화시키지 않는다.

### 5.2 반드시 사람에게 넘길 실패

다음은 자동 수정·자동 반복하지 않는다.

- Protected 실패 또는 승인 범위 선택
- Issue와 SSOT의 충돌
- SSOT끼리의 충돌
- 요구사항·아키텍처·스키마·작업 범위 변경 필요
- 원인이 모호하거나 재현되지 않는 실패
- flaky 실패
- OS·도구·네트워크 등 구현에 귀속되지 않는 환경 실패
- Issue 종료 조건 또는 `max-loops` 누락·모호함
- 최대 시도 횟수 초과
- 다른 에이전트의 열린 claim 또는 head 충돌
- Review와 Merge 판단

분류가 확실하지 않으면 안전한 쪽으로 `NEEDS_HUMAN`으로 보낸다.

---

## 6. 사람의 판단

### 6.1 사람 개입이 필요한 순간

사람의 명시적인 판단이 필요한 경우는 다음과 같다.

1. 보호 경로 변경을 승인할지 되돌릴지 결정할 때
2. Issue와 SSOT가 충돌할 때
3. SSOT끼리 충돌할 때
4. 작업 범위나 요구사항을 바꿀 때
5. 모호하거나 flaky한 실패를 해석할 때
6. 최대 시도 횟수에 도달했을 때
7. 열린 시도를 폐기하고 새 시도로 시작할 때
8. 최대 횟수를 재설정하거나 새 루프로 시작할 때
9. 두 에이전트가 같은 작업을 주장할 때
10. Review에서 수정 요청 또는 승인할 때
11. Merge할 때

사람에게 질문할 때는 다음을 함께 제시한다.

```text
무엇이 발생했는가
어떤 파일·커밋·검증 단계가 관련됐는가
현재 시도 / 최대 시도
선택 가능한 결정
결정하지 않으면 작업이 어디에서 멈추는가
```

사람의 응답 없이 에이전트가 추측해 진행하지 않는다.

### 6.2 사람 결정 기록

결정은 원장에 다음과 같이 남긴다.

```text
decision: HUMAN_APPROVED | HUMAN_REJECTED | RESUME_REQUESTED |
          RETRY_RESET | SCOPE_CHANGED | ABANDONED
actor: <human identity>
at: <timestamp>
reason: <why>
related issue/pr: <reference>
affected paths: <paths>
next state: <state>
```

Protected 승인 명령은 `docs/harness/01-ssot.md §6`의 규칙을 따른다.

- 사람이 `--scope`를 직접 지정한다.
- 지정하지 않은 보호 경로는 승인되지 않는다.
- `protected.json`을 사람이 승인 변경과 같은 커밋에 담는다.
- Protected 승인은 승인한 경로의 내용만 허용한다.
- Protected 승인은 구현 시도 카운터를 초기화하지 않는다.

---

## 7. 세션 중단과 재개

### 7.1 새 세션의 읽기 전용 복구

새 에이전트 세션은 수정 전에 다음을 확인한다.

```bash
git fetch --all --prune
git status --short --branch
git branch -vv
git worktree list
git log --oneline --decorate -n 10
gh issue view <issue> --repo <repo>
gh pr view <pr> --repo <repo>
```

그 다음 Issue/PR 원장을 읽고 다음을 요약한다.

```text
Issue / PR
branch
base SHA / head SHA
local / upstream divergence
working-tree status
open worktree claim
loop state
consumed / maximum attempts
current attempt status
last 02 result and first failing stage
pending human decision
next permitted action
```

### 7.2 복구 규칙

- 원장의 head와 현재 head가 다르면 수정하지 않고 `NEEDS_HUMAN`으로 보낸다.
- 예상하지 못한 미커밋 변경이 있으면 수정하지 않고 `NEEDS_HUMAN`으로 보낸다.
- 같은 Issue의 다른 열린 claim이 있으면 수정하지 않고 사람에게 확인한다.
- 원장에 `attempt_started`만 있고 02 판정이 없으면 기존 시도를 우선 재개한다.
- 열린 시도를 폐기하거나 새 번호를 부여하는 것은 사람의 결정이 필요하다.
- 02 판정 없이 세션이 끊긴 시도는 소비하지 않는다.
- 원장 자체가 없거나 손상되어 시도를 판별할 수 없으면 자동으로 소비·복구하지 않는다.

세션 재개는 시도 횟수를 초기화하지 않는다.

### 7.3 동시성

동일 Issue/PR에는 한 번에 하나의 열린 구현 claim만 허용한다.

claim에는 다음을 기록한다.

```text
issue / pr
branch
head SHA
agent/session identifier
claimed at
last heartbeat
```

stale claim의 자동 해제 여부와 기준은 사람의 정책으로 확정하기 전까지 보수적으로 처리한다. 확신할 수 없는 claim은 `NEEDS_HUMAN`으로 보낸다.

---

## 8. 검증 증거

02는 판정만 제공하고, 03은 그 판정을 작업 원장과 연결한다.

각 02 실행에 다음을 붙인다.

- 대상 head SHA
- 실행 명령
- local/CI run identifier
- `PASS`/`FAIL`/`CANCELLED`
- 첫 실패 단계
- 실패 출력 또는 로그 아티팩트 참조
- OS, Node, package 환경
- CI 실행·재실행 번호
- 검증용 DB가 초기화됐다는 사실
- 다음 행동

`verify.db`는 현재처럼 매 실행 새로 만들고, 실패 로그·메타데이터는 별도 진단 아티팩트로 보존한다.

CI가 새 커밋 때문에 취소되면 다음과 같이 기록한다.

```text
result: CANCELLED
cancelledBy: <new head SHA>
lastKnownStage: <stage or unknown>
```

취소는 성공으로 보지 않으며, 자동으로 구현 시도를 소비하지 않는다.

---

## 9. 완료 판정과 사람 게이트

02가 `PASS`를 반환했다고 즉시 Issue를 닫거나 Merge하지 않는다.

`READY_FOR_REVIEW` 전 확인:

- Issue와 작업 범위가 일치한다.
- `max-loops`가 확정되어 있다.
- 모든 종료 조건에 테스트 또는 명시된 증거가 있다.
- `tests/issues/issue-<번호>-<기능명>.test.ts`가 존재한다.
- 전용 테스트 파일이 회귀 테스트로 유지된다.
- 최종 head SHA에 대한 02 `PASS`가 기록되어 있다.
- 승인되지 않은 Protected 변경이 없다.
- 시도 원장과 실패·재시도 기록이 완결되어 있다.

기계가 자연어 종료 조건의 의미까지 증명할 수 없으면 증거 부족으로 `NEEDS_HUMAN`에 둔다.

`READY_FOR_MERGE`에는 추가로 다음이 필요하다.

- 사람의 Review 완료
- Review에서 요청된 변경이 모두 처리됨
- 최종 head에 대한 02 `PASS`
- CI의 해당 head 결과 확인
- 사람의 Merge 결정

`MERGED`는 실제 Merge 이후에만 기록한다.

---

## 10. 실패 시 행동 표

| 02 판정 또는 사건 | 03의 기본 행동 | 사람 필요 |
|---|---|---|
| `PASS` | 완료 증거를 모아 `READY_FOR_REVIEW` | Review 필요 |
| 변경 코드의 결정적 Type/Lint 실패 | 남은 예산 안에서 수정 후 재시도 | 아니오 |
| Issue로 기대 결과가 정해진 결정적 Test 실패 | 수정 후 재시도 | 아니오 |
| Protected 실패 | `NEEDS_HUMAN` | 승인 또는 되돌림 |
| Issue/SSOT 충돌 | `NEEDS_HUMAN` | 해석 결정 |
| 모호·flaky한 실패 | `NEEDS_HUMAN` | 원인 판단 |
| 환경 실패 | `NEEDS_HUMAN` | 환경 조치·시도 처리 |
| 최대 시도 도달 | `RETRY_EXHAUSTED` 후 `NEEDS_HUMAN` | 계속·재설정·중단 |
| 세션 중단 전 02 판정 | 열린 시도 유지 후 재개 | 폐기 시 필요 |
| 원장·Git 상태 불일치 | 수정하지 않고 `NEEDS_HUMAN` | 상태 정리 |
| 02 동일 head 재실행 | 증거 재실행만 기록 | 아니오 |
| Review 수정 요청 | 남은 예산 확인 후 재개 | Review 결정 필요 |
| Merge 요청 | `READY_FOR_MERGE`에서 정지 | 예 |

---

## 11. 구현 예정 항목

이 초안이 승인되면 다음 순서로 집행 수단을 만든다.

1. 이 문서를 `docs/harness/01-ssot.md`의 구현·검증 루프 원본으로 등록한다.
2. Issue/PR 원장 형식과 기록 위치를 확정한다.
3. 세션 시작·재개 정보를 읽는 진단 명령을 만든다.
4. 시도 시작·판정 완료·중단·재개 상태를 기록한다.
5. `max-loops`를 읽고 최대 횟수를 집행한다.
6. 02 결과를 실패 유형으로 분류하되 모호한 경우 사람에게 넘긴다.
7. Issue 전용 테스트와 종료 조건 증거의 기본 연결을 검사한다.
8. CI 실패·취소 아티팩트를 Issue/PR에 연결한다.
9. 두 에이전트의 동시 claim과 head 충돌을 막는다.
10. Windows/Linux에서 같은 02 명령을 실행할 수 있도록 환경 설정을 이식 가능하게 만든다.

집행 수단은 이 문서의 규칙을 약화하거나 02의 판정을 복제하지 않는다.

---

## 12. 사람의 결정이 필요한 정책

다음은 구현 전에 사람이 확정해야 한다.

1. Issue와 PR 중 어느 쪽을 원장의 대표 위치로 할지
2. 원장을 append 댓글로 둘지, 구조화된 단일 댓글을 갱신할지
3. 자동 코드 수정을 허용할지, 허용한다면 기계적 실패의 정확한 범위
4. 02 판정이 없을 때 시도를 소비하지 않는 정책의 최종 확정
5. 사람이 같은 Issue에서 최대 횟수를 재설정할 수 있는지
6. 재설정 시 기존 루프와 새 루프를 어떻게 구분할지
7. CI 재실행을 증거 재실행으로만 볼지
8. 동시 에이전트를 금지할지, claim/lock으로 관리할지
9. stale claim을 자동 해제할지
10. `NEEDS_HUMAN`, `RETRY_EXHAUSTED`, `READY_FOR_REVIEW`, `READY_FOR_MERGE`에서 필요한 사람 행동
11. 승인자 식별과 Issue/PR 참조를 Protected 승인 기록에 필수화할지

정책이 확정되지 않은 항목은 집행 수단이 임의로 결정하지 않는다.

---

## 13. 검증 계획

03-loop 집행 수단은 최소한 다음을 검증한다.

- 기계적 실패 1회 후 수정·재검증 성공
- 최대 시도 횟수 소진 후 자동 반복 중단
- Protected 실패 후 사람 대기
- Issue/SSOT 충돌 후 사람 대기
- 세션 중단 후 같은 열린 시도 재개
- 새 에이전트 세션에서 카운터를 초기화하지 않음
- 동일 head의 02 재실행이 시도를 소비하지 않음
- 서로 다른 head 또는 동시 claim 충돌 차단
- CI 취소가 성공이나 자동 시도로 오인되지 않음
- 전용 테스트와 최종 02 `PASS` 없이는 완료 상태로 이동하지 않음

`03-loop` 자체의 판정도 별도의 테스트와 CI 검증을 거친다. 이 문서가 정본으로 등록되기 전까지는 이 문서의 규칙을 기존 `npm run verify`에 자동으로 추가하지 않는다.
