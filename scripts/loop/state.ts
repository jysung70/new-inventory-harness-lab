/**
 * 03-loop 집행 수단의 순수 상태 규칙.
 *
 * 원본: docs/harness/03-loop.md
 * 검증 판정은 여기서 하지 않는다. 이 모듈은 02 결과 이후의 다음 상태만 계산한다.
 */

export const MAX_LOOPS = [1, 2, 3, 5] as const
export type MaxLoops = (typeof MAX_LOOPS)[number]

export type LoopState =
  | 'READY'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'PASSED'
  | 'RETRYABLE_FAILURE'
  | 'RETRY_EXHAUSTED'
  | 'NEEDS_HUMAN'
  | 'READY_FOR_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'READY_FOR_MERGE'
  | 'MERGED'
  | 'ABANDONED'

export type FailureKind =
  | 'protected'
  | 'prepare'
  | 'typecheck'
  | 'lint'
  | 'architecture'
  | 'test'
  | 'build'
  | 'infrastructure'
  | 'unknown'

export type VerificationResult = {
  result: 'PASS' | 'FAIL' | 'CANCELLED'
  stage?: FailureKind
  summary?: string
  headSha: string
  runId: string
}

export type Attempt = {
  number: number
  headSha: string
  status: 'OPEN' | 'JUDGED' | 'INTERRUPTED'
  startedAt: string
  judgedAt?: string
  verification?: VerificationResult
}

export type LoopLedger = {
  schemaVersion: 1
  issue: number
  maxLoops: MaxLoops
  state: LoopState
  consumedAttempts: number
  attempts: Attempt[]
  activeClaim?: { sessionId: string; claimedAt: string; headSha: string }
}

export function parseMaxLoops(raw: string | undefined): MaxLoops {
  const value = raw?.trim()
  if (!value || !MAX_LOOPS.includes(Number(value) as MaxLoops) || !/^\d+$/.test(value)) {
    throw new Error('Issue의 max-loops는 1, 2, 3, 5 중 하나여야 합니다')
  }
  return Number(value) as MaxLoops
}

export function remainingAttempts(ledger: Pick<LoopLedger, 'maxLoops' | 'consumedAttempts'>): number {
  return Math.max(0, ledger.maxLoops - ledger.consumedAttempts)
}

export function classifyVerification(result: VerificationResult): FailureKind | null {
  if (result.result === 'PASS') return null
  if (result.result === 'CANCELLED') return 'infrastructure'
  return result.stage ?? 'unknown'
}

export function isHumanRequired(kind: FailureKind | null): boolean {
  return kind === null || kind === 'protected' || kind === 'prepare' || kind === 'infrastructure' || kind === 'unknown'
}

export function judgeAttempt(ledger: LoopLedger, attemptNumber: number, result: VerificationResult, judgedAt: string): LoopLedger {
  const attempt = ledger.attempts.find((x) => x.number === attemptNumber)
  if (!attempt) throw new Error(`시도 ${attemptNumber}를 찾을 수 없습니다`)
  if (attempt.status === 'JUDGED') throw new Error(`시도 ${attemptNumber}는 이미 판정되었습니다`)
  if (attempt.headSha !== result.headSha) throw new Error('시도와 검증 결과의 head SHA가 다릅니다')

  const kind = classifyVerification(result)
  const nextAttempts = ledger.attempts.map((x) =>
    x.number === attemptNumber ? { ...x, status: 'JUDGED' as const, judgedAt, verification: result } : x,
  )
  const consumedAttempts = ledger.consumedAttempts + 1

  if (result.result === 'PASS') {
    return { ...ledger, attempts: nextAttempts, consumedAttempts, state: 'PASSED' }
  }
  if (isHumanRequired(kind)) {
    return { ...ledger, attempts: nextAttempts, consumedAttempts, state: 'NEEDS_HUMAN' }
  }
  return {
    ...ledger,
    attempts: nextAttempts,
    consumedAttempts,
    state: consumedAttempts < ledger.maxLoops ? 'RETRYABLE_FAILURE' : 'RETRY_EXHAUSTED',
  }
}

export function startAttempt(ledger: LoopLedger, headSha: string, startedAt: string): LoopLedger {
  if (ledger.activeClaim) throw new Error('이미 다른 세션이 이 Issue를 작업 중입니다')
  if (ledger.consumedAttempts >= ledger.maxLoops) throw new Error('최대 시도 횟수를 모두 사용했습니다')
  const number = ledger.attempts.length + 1
  return {
    ...ledger,
    state: 'IN_PROGRESS',
    attempts: [...ledger.attempts, { number, headSha, status: 'OPEN', startedAt }],
  }
}

export function interruptAttempt(ledger: LoopLedger, attemptNumber: number): LoopLedger {
  return {
    ...ledger,
    attempts: ledger.attempts.map((x) => x.number === attemptNumber ? { ...x, status: 'INTERRUPTED' as const } : x),
    state: 'IN_PROGRESS',
  }
}

export function beginReview(ledger: LoopLedger): LoopLedger {
  if (ledger.state !== 'PASSED') throw new Error('02 PASS 후에만 Review 준비 상태가 됩니다')
  return { ...ledger, state: 'READY_FOR_REVIEW' }
}
