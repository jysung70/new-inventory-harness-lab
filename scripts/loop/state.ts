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
  | 'READY_FOR_REVIEW'
  | 'READY_FOR_PR'
  | 'PR_OPEN'
  | 'CI_PENDING'
  | 'CI_RUNNING'
  | 'CI_PASSED'
  | 'CI_FAILED'
  | 'CI_CANCELLED'
  | 'HUMAN_REVIEW'
  | 'RETRYABLE_FAILURE'
  | 'RETRY_EXHAUSTED'
  | 'NEEDS_HUMAN'
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

export type CompletionEvidence = {
  headSha: string
  localVerifyRunId: string
  localVerifyResult: 'PASS'
  issueConditionsComplete: boolean
  completionCommentId: string
}

export type PrLink = {
  number: number
  url: string
  branch: string
  baseSha: string
  headSha: string
}

export type CiRun = {
  runId: string
  headSha: string
  status: 'PENDING' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED'
  firstFailingStage?: FailureKind
  rerunId?: string
  reproducedLocally?: boolean
}

export type LoopLedger = {
  schemaVersion: 1
  issue: number
  repository?: string
  branch?: string
  baseSha?: string
  headSha?: string
  changedPaths?: string[]
  maxLoops: MaxLoops
  state: LoopState
  consumedAttempts: number
  attempts: Attempt[]
  completion?: CompletionEvidence
  verification?: VerificationResult
  completionCommentId?: string
  humanDecision?: string
  nextAction?: string
  session?: { agent: string; sessionId: string; updatedAt: string }
  pr?: PrLink
  ciRuns?: CiRun[]
  activeClaim?: { sessionId: string; claimedAt: string; headSha: string }
}

export function canEnterPr(ledger: LoopLedger, headSha: string): boolean {
  return ledger.state === 'READY_FOR_PR' && ledger.completion?.headSha === headSha &&
    ledger.completion.localVerifyRunId.length > 0 && ledger.completion.issueConditionsComplete &&
    ledger.completion.completionCommentId.length > 0
}

export function linkPr(ledger: LoopLedger, pr: PrLink): LoopLedger {
  if (!canEnterPr(ledger, pr.headSha)) throw new Error('로컬 PASS·Issue 종료 조건·완료 코멘트가 같은 head에 없습니다')
  if (ledger.pr && (ledger.pr.number !== pr.number || ledger.pr.headSha !== pr.headSha))
    throw new Error('다른 PR 또는 head가 이미 연결되어 있습니다')
  return { ...ledger, pr, state: 'PR_OPEN' }
}

export function recordCi(ledger: LoopLedger, run: CiRun): LoopLedger {
  if (!ledger.pr || ledger.pr.headSha !== run.headSha) throw new Error('CI 결과의 head가 PR head와 다릅니다')
  const ciRuns = [...(ledger.ciRuns ?? []), run]
  const state = run.status === 'PASS' ? 'CI_PASSED' : run.status === 'FAIL' ? 'CI_FAILED' : run.status === 'CANCELLED' ? 'CI_CANCELLED' : run.status === 'RUNNING' ? 'CI_RUNNING' : 'CI_PENDING'
  return { ...ledger, ciRuns, state }
}

export function handleCiReproduction(ledger: LoopLedger, runId: string, reproduced: boolean): LoopLedger {
  const run = ledger.ciRuns?.find((x) => x.runId === runId)
  if (!run || run.status !== 'FAIL') throw new Error('재현할 CI 실패 기록을 찾을 수 없습니다')
  const updatedRuns = ledger.ciRuns!.map((x) => x.runId === runId ? { ...x, reproducedLocally: reproduced } : x)
  return { ...ledger, ciRuns: updatedRuns, state: reproduced ? 'IN_PROGRESS' : 'NEEDS_HUMAN' }
}

export function humanReview(ledger: LoopLedger): LoopLedger {
  const current = ledger.ciRuns?.at(-1)
  if (ledger.state !== 'CI_PASSED' || !ledger.pr || current?.headSha !== ledger.pr.headSha)
    throw new Error('현재 PR head의 CI PASS 후에만 사람 Review로 이동할 수 있습니다')
  return { ...ledger, state: 'HUMAN_REVIEW' }
}

export function recordCompletion(ledger: LoopLedger, evidence: CompletionEvidence): LoopLedger {
  if (ledger.state !== 'PASSED') throw new Error('02 PASS 후에만 완료 증거를 기록할 수 있습니다')
  const last = ledger.attempts.at(-1)
  if (!last || last.status !== 'JUDGED' || last.headSha !== evidence.headSha || last.verification?.result !== 'PASS') {
    throw new Error('완료 증거는 현재 head의 02 PASS 뒤에만 기록할 수 있습니다')
  }
  if (!evidence.issueConditionsComplete || !evidence.localVerifyRunId || !evidence.completionCommentId) {
    throw new Error('로컬 PASS·Issue 종료 조건·완료 코멘트가 모두 필요합니다')
  }
  return { ...ledger, completion: evidence, state: 'READY_FOR_PR' }
}

export function isSameHeadVerification(ledger: LoopLedger, headSha: string): boolean {
  return ledger.attempts.some((attempt) => attempt.headSha === headSha)
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
