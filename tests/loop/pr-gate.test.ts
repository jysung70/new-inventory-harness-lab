import { describe, expect, it } from 'vitest'
import {
  canEnterPr,
  handleCiReproduction,
  humanReview,
  judgeAttempt,
  linkPr,
  recordCi,
  recordCompletion,
  startAttempt,
  type LoopLedger,
} from '@/../scripts/loop/state'

function passedLedger(): LoopLedger {
  const started = startAttempt({
    schemaVersion: 1,
    issue: 42,
    maxLoops: 3,
    state: 'READY',
    consumedAttempts: 0,
    attempts: [],
  }, 'head-1', '2026-08-27T00:00:00Z')
  return judgeAttempt(started, 1, {
    result: 'PASS',
    headSha: 'head-1',
    runId: 'local-1',
  }, '2026-08-27T00:01:00Z')
}

describe('03-loop PR·CI 게이트', () => {
  it('로컬 PASS·Issue 종료 조건·완료 코멘트가 있어야 PR에 진입한다', () => {
    const ready = recordCompletion(passedLedger(), {
      headSha: 'head-1',
      localVerifyRunId: 'local-verify-1',
      localVerifyResult: 'PASS',
      issueConditionsComplete: true,
      completionCommentId: 'comment-1',
    })
    expect(canEnterPr(ready, 'head-1')).toBe(true)
    expect(canEnterPr(ready, 'head-2')).toBe(false)
  })

  it('완료 증거가 없거나 다른 head면 PR 진입을 막는다', () => {
    expect(canEnterPr(passedLedger(), 'head-1')).toBe(false)
    expect(() => recordCompletion(passedLedger(), {
      headSha: 'head-2',
      localVerifyRunId: 'local-verify-1',
      localVerifyResult: 'PASS',
      issueConditionsComplete: true,
      completionCommentId: 'comment-1',
    })).toThrow()
  })

  it('일치하는 PR만 연결하고 CI 결과를 현재 head에 묶는다', () => {
    const ready = recordCompletion(passedLedger(), {
      headSha: 'head-1',
      localVerifyRunId: 'local-verify-1',
      localVerifyResult: 'PASS',
      issueConditionsComplete: true,
      completionCommentId: 'comment-1',
    })
    const linked = linkPr(ready, {
      number: 7,
      url: 'https://example.test/pr/7',
      branch: 'feat/example',
      baseSha: 'main-1',
      headSha: 'head-1',
    })
    expect(linked.state).toBe('PR_OPEN')
    expect(() => recordCi(linked, { runId: 'ci-1', headSha: 'other', status: 'PASS' })).toThrow()
    const running = recordCi(linked, { runId: 'ci-1', headSha: 'head-1', status: 'RUNNING' })
    expect(running.consumedAttempts).toBe(1)
    expect(running.state).toBe('CI_RUNNING')
  })

  it('현재 head의 CI PASS 후에도 자동 Merge하지 않고 사람 Review로 보낸다', () => {
    const ready = recordCompletion(passedLedger(), {
      headSha: 'head-1', localVerifyRunId: 'local-verify-1', localVerifyResult: 'PASS', issueConditionsComplete: true, completionCommentId: 'comment-1',
    })
    const linked = linkPr(ready, { number: 7, url: 'url', branch: 'branch', baseSha: 'base', headSha: 'head-1' })
    const passed = recordCi(linked, { runId: 'ci-1', headSha: 'head-1', status: 'PASS' })
    expect(humanReview(passed).state).toBe('HUMAN_REVIEW')
  })

  it('CI 실패가 같은 head에서 재현되면 기존 루프로 돌아가고 시도는 CI 때문에 늘지 않는다', () => {
    const ready = recordCompletion(passedLedger(), {
      headSha: 'head-1', localVerifyRunId: 'local-verify-1', localVerifyResult: 'PASS', issueConditionsComplete: true, completionCommentId: 'comment-1',
    })
    const linked = linkPr(ready, { number: 7, url: 'url', branch: 'branch', baseSha: 'base', headSha: 'head-1' })
    const failed = recordCi(linked, { runId: 'ci-1', headSha: 'head-1', status: 'FAIL', firstFailingStage: 'test' })
    const returned = handleCiReproduction(failed, 'ci-1', true)
    expect(returned.state).toBe('IN_PROGRESS')
    expect(returned.consumedAttempts).toBe(1)
  })

  it('CI 실패가 로컬에서 재현되지 않으면 NEEDS_HUMAN으로 멈춘다', () => {
    const ready = recordCompletion(passedLedger(), {
      headSha: 'head-1', localVerifyRunId: 'local-verify-1', localVerifyResult: 'PASS', issueConditionsComplete: true, completionCommentId: 'comment-1',
    })
    const linked = linkPr(ready, { number: 7, url: 'url', branch: 'branch', baseSha: 'base', headSha: 'head-1' })
    const failed = recordCi(linked, { runId: 'ci-1', headSha: 'head-1', status: 'FAIL', firstFailingStage: 'test' })
    expect(handleCiReproduction(failed, 'ci-1', false).state).toBe('NEEDS_HUMAN')
  })
})
