import { describe, expect, it } from 'vitest'
import {
  classifyVerification,
  judgeAttempt,
  parseMaxLoops,
  startAttempt,
  type LoopLedger,
} from '@/../scripts/loop/state'
import { decodeLedger, encodeLedger } from '@/../scripts/loop/ledger'

const base = (): LoopLedger => ({
  schemaVersion: 1,
  issue: 42,
  maxLoops: 3,
  state: 'READY',
  consumedAttempts: 0,
  attempts: [],
})

describe('03-loop 상태 규칙', () => {
  it.each(['1', '2', '3', '5'])('허용된 max-loops %s를 파싱한다', (raw) => {
    expect(parseMaxLoops(raw)).toBe(Number(raw))
  })

  it.each([undefined, '', '0', '4', '2.0', 'three'])('잘못된 max-loops %s를 거부한다', (raw) => {
    expect(() => parseMaxLoops(raw)).toThrow()
  })

  it('초기 구현 시도를 추가하고 활성 claim이 있으면 막는다', () => {
    const started = startAttempt(base(), 'abc', '2026-08-27T00:00:00Z')
    expect(started.attempts).toHaveLength(1)
    expect(started.consumedAttempts).toBe(0)
    expect(() => startAttempt({ ...started, activeClaim: { sessionId: 'other', claimedAt: 'now', headSha: 'abc' } }, 'def', 'now')).toThrow()
  })

  it('02 PASS가 기록될 때만 시도를 소비한다', () => {
    const started = startAttempt(base(), 'abc', '2026-08-27T00:00:00Z')
    const judged = judgeAttempt(started, 1, { result: 'PASS', headSha: 'abc', runId: 'run-1' }, '2026-08-27T00:01:00Z')
    expect(judged.consumedAttempts).toBe(1)
    expect(judged.state).toBe('PASSED')
  })

  it('기계적 실패는 남은 횟수 동안 반복할 수 있다', () => {
    const started = startAttempt(base(), 'abc', 'now')
    const judged = judgeAttempt(started, 1, { result: 'FAIL', stage: 'typecheck', headSha: 'abc', runId: 'run-1' }, 'later')
    expect(judged.consumedAttempts).toBe(1)
    expect(judged.state).toBe('RETRYABLE_FAILURE')
  })

  it('최대 횟수에 도달하면 사람 판단으로 멈춘다', () => {
    let ledger = base()
    for (const [number, sha] of [[1, 'a'], [2, 'b'], [3, 'c']] as const) {
      ledger = startAttempt(ledger, sha, 'now')
      ledger = judgeAttempt(ledger, number, { result: 'FAIL', stage: 'test', headSha: sha, runId: `run-${number}` }, 'later')
    }
    expect(ledger.consumedAttempts).toBe(3)
    expect(ledger.state).toBe('RETRY_EXHAUSTED')
  })

  it('보호 경로·취소·알 수 없는 실패를 사람 판단으로 분류한다', () => {
    expect(classifyVerification({ result: 'FAIL', stage: 'protected', headSha: 'a', runId: '1' })).toBe('protected')
    expect(classifyVerification({ result: 'CANCELLED', headSha: 'a', runId: '1' })).toBe('infrastructure')
    expect(classifyVerification({ result: 'FAIL', headSha: 'a', runId: '1' })).toBe('unknown')
  })

  it('원장을 안정적으로 직렬화하고 복원한다', () => {
    const ledger = startAttempt(base(), 'abc', 'now')
    expect(decodeLedger(encodeLedger(ledger))).toEqual(ledger)
  })
})
