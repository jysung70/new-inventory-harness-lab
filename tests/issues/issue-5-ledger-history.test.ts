import { describe, expect, it } from 'vitest'
import {
  CURRENT_MARKER,
  EVENT_MARKER,
  decodeEvent,
  decodeLedger,
  encodeEvent,
  encodeLedger,
  parseIssueComments,
  type LoopEvent,
} from '../../scripts/loop/ledger'
import type { LoopLedger } from '../../scripts/loop/state'

const ledger = (state: LoopLedger['state'] = 'READY'): LoopLedger => ({
  schemaVersion: 1,
  issue: 3,
  repository: 'jysung70/new-inventory-harness-lab',
  branch: 'feat/example',
  baseSha: 'base',
  headSha: 'head',
  maxLoops: 3,
  state,
  consumedAttempts: 0,
  attempts: [],
  nextAction: 'resume',
})

const event = (nextState: string): LoopEvent => ({
  eventId: `event-${nextState}`,
  eventType: 'state_transition',
  issue: 3,
  attempt: 1,
  headSha: 'head',
  timestamp: '2026-08-27T00:00:00Z',
  actor: 'test',
  previousState: 'READY',
  nextState,
})

describe('Issue #5 — CURRENT Ledger와 Event History', () => {
  it('CURRENT Ledger 하나를 정상적으로 읽는다', () => {
    expect(decodeLedger(encodeLedger(ledger()))?.state).toBe('READY')
  })

  it('CURRENT Ledger 두 개는 모호한 상태로 거부한다', () => {
    expect(() => parseIssueComments([
      { id: 1, body: encodeLedger(ledger()) },
      { id: 2, body: encodeLedger(ledger('IN_PROGRESS')) },
    ])).toThrow('CURRENT Ledger가 여러 개입니다')
  })

  it('Event History 여러 개는 정상적으로 읽는다', () => {
    const parsed = parseIssueComments([
      { id: 1, body: encodeLedger(ledger()) },
      { id: 2, body: encodeEvent(event('IN_PROGRESS')) },
      { id: 3, body: encodeEvent(event('VERIFYING')) },
    ])
    expect(parsed.events).toHaveLength(2)
  })

  it('이벤트를 append해도 과거 이벤트가 보존된다', () => {
    const first = encodeEvent(event('IN_PROGRESS'))
    const second = encodeEvent(event('VERIFYING'))
    const parsed = parseIssueComments([{ body: first }, { body: second }])
    expect(parsed.events.map((x) => x.nextState)).toEqual(['IN_PROGRESS', 'VERIFYING'])
  })

  it('CURRENT와 마지막 event가 일치하는 상태는 resume할 수 있다', () => {
    const parsed = parseIssueComments([
      { body: encodeLedger(ledger('VERIFYING')) },
      { body: encodeEvent(event('VERIFYING')) },
    ])
    expect(parsed.current?.ledger.state).toBe(parsed.events.at(-1)?.nextState)
  })

  it('CURRENT와 마지막 event가 다르면 복구 검증에서 구분할 수 있다', () => {
    const parsed = parseIssueComments([
      { body: encodeLedger(ledger('NEEDS_HUMAN')) },
      { body: encodeEvent(event('VERIFYING')) },
    ])
    expect(parsed.current?.ledger.state).not.toBe(parsed.events.at(-1)?.nextState)
  })

  it('attempt counter snapshot을 복구한다', () => {
    const current = ledger('IN_PROGRESS')
    current.consumedAttempts = 1
    current.attempts = [{ number: 1, headSha: 'head', status: 'JUDGED', startedAt: 'now' }]
    expect(decodeLedger(encodeLedger(current))?.consumedAttempts).toBe(1)
  })

  it('verification_blocked 이벤트는 소비 여부를 바꾸지 않는다', () => {
    const current = ledger('NEEDS_HUMAN')
    const blocked = { ...event('NEEDS_HUMAN'), eventType: 'verification_blocked' }
    expect(parseIssueComments([{ body: encodeLedger(current) }, { body: encodeEvent(blocked) }]).current?.ledger.consumedAttempts).toBe(0)
  })

  it('verification_passed 이벤트와 완료 상태를 보존한다', () => {
    const passed = { ...event('PASSED'), eventType: 'verification_passed' }
    expect(decodeEvent(encodeEvent(passed))?.eventType).toBe('verification_passed')
  })

  it('session_interrupted 이벤트를 보존한다', () => {
    const interrupted = { ...event('IN_PROGRESS'), eventType: 'session_interrupted' }
    expect(decodeEvent(encodeEvent(interrupted))?.eventType).toBe('session_interrupted')
  })

  it('human_decision 이벤트를 보존한다', () => {
    const decision = { ...event('NEEDS_HUMAN'), eventType: 'human_decision' }
    expect(decodeEvent(encodeEvent(decision))?.eventType).toBe('human_decision')
  })

  it('PR과 CI 이벤트를 보존한다', () => {
    const parsed = parseIssueComments([
      { body: encodeEvent({ ...event('PR_OPEN'), eventType: 'pr_created' }) },
      { body: encodeEvent({ ...event('CI_FAILED'), eventType: 'ci_failed' }) },
    ])
    expect(parsed.events.map((x) => x.eventType)).toEqual(['pr_created', 'ci_failed'])
  })

  it('Issue #3의 legacy duplicate marker를 삭제하지 않고 분류한다', () => {
    const legacy = (value: LoopLedger) => [
      '<!-- inventory-harness:03-loop -->',
      '<!-- schema: 1 -->',
      '```json',
      JSON.stringify(value),
      '```',
    ].join('\n')
    const parsed = parseIssueComments([
      { body: legacy(ledger()) },
      { body: legacy(ledger('IN_PROGRESS')) },
    ])
    expect(parsed.current).toBeNull()
    expect(parsed.legacy).toHaveLength(2)
  })

  it('marker 종류가 CURRENT와 EVENT로 분리된다', () => {
    expect(encodeLedger(ledger())).toContain(CURRENT_MARKER)
    expect(encodeEvent(event('READY'))).toContain(EVENT_MARKER)
  })
})
