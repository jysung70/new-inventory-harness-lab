/** Issue CURRENT Ledger와 append-only Event History 어댑터.
 * 원본: docs/harness/03-loop.md
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { LoopLedger } from './state'

export const LEDGER_MARKER = '<!-- inventory-harness:03-loop -->'
export const CURRENT_MARKER = '<!-- inventory-harness:03-loop:current -->'
export const EVENT_MARKER = '<!-- inventory-harness:03-loop:event -->'
export const LEDGER_SCHEMA = 1
export const EVENT_SCHEMA = 1

type Gh = (args: string[]) => string

type Comment = { id?: number | string; body: string }

export type LoopEvent = {
  eventId: string
  eventType: string
  issue: number
  attempt?: number
  headSha?: string
  timestamp: string
  actor?: string
  evidence?: string
  previousState?: string
  nextState?: string
}

export function encodeLedger(ledger: LoopLedger): string {
  return `${CURRENT_MARKER}\n<!-- schema: ${LEDGER_SCHEMA} -->\n\`\`\`json\n${JSON.stringify(ledger, null, 2)}\n\`\`\``
}

export function encodeEvent(event: LoopEvent): string {
  return `${EVENT_MARKER}\n<!-- schema: ${EVENT_SCHEMA} -->\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``
}

function decodeJsonBlock(body: string): unknown {
  const match = body.match(/```json\n([\s\S]*?)\n```/)
  if (!match) throw new Error('03-loop JSON 블록을 찾을 수 없습니다')
  return JSON.parse(match[1])
}

export function decodeLedger(body: string): LoopLedger | null {
  if (!body.includes(CURRENT_MARKER) && !body.includes(LEDGER_MARKER)) return null
  const value = decodeJsonBlock(body) as LoopLedger
  if (value.schemaVersion !== LEDGER_SCHEMA || !Array.isArray(value.attempts)) {
    throw new Error('지원하지 않는 03-loop 원장 형식입니다')
  }
  return value
}

export function decodeEvent(body: string): LoopEvent | null {
  if (!body.includes(EVENT_MARKER)) return null
  const value = decodeJsonBlock(body) as LoopEvent
  if (typeof value.eventId !== 'string' || typeof value.eventType !== 'string' || typeof value.issue !== 'number') {
    throw new Error('잘못된 03-loop 이벤트 형식입니다')
  }
  return value
}

export function parseIssueMaxLoops(body: string): string | undefined {
  const section = body.match(/(?:^|\n)#{1,6}\s*6\.\s*[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i)
  const value = section?.[1].match(/^\s*(?:[-*]\s*)?([1235])\s*$/m)
  return value?.[1]
}

export function ghCli(): Gh {
  return (args) => execFileSync('gh', args, { encoding: 'utf8' })
}

export function parseIssueComments(comments: Comment[]): {
  current: { id?: number | string; ledger: LoopLedger } | null
  events: LoopEvent[]
  legacy: LoopLedger[]
} {
  let current: { id?: number | string; ledger: LoopLedger } | null = null
  const events: LoopEvent[] = []
  const legacy: LoopLedger[] = []

  for (const comment of comments) {
    if (comment.body.includes(CURRENT_MARKER)) {
      if (current) throw new Error('CURRENT Ledger가 여러 개입니다')
      const ledger = decodeLedger(comment.body)
      if (ledger) current = { id: comment.id, ledger }
      continue
    }
    const event = decodeEvent(comment.body)
    if (event) {
      events.push(event)
      continue
    }
    if (comment.body.includes(LEDGER_MARKER)) {
      const ledger = decodeLedger(comment.body)
      if (ledger) legacy.push(ledger)
    }
  }
  return { current, events, legacy }
}

export function readIssueState(gh: Gh, repo: string, issue: number) {
  const raw = gh(['api', `repos/${repo}/issues/${issue}/comments`, '--paginate'])
  const comments = JSON.parse(raw) as Comment[]
  return parseIssueComments(comments)
}

/** 새 CURRENT snapshot을 만들거나 기존 CURRENT 댓글을 명시적으로 갱신한다. */
export function writeCurrentLedger(gh: Gh, repo: string, issue: number, current: { id?: number | string; ledger: LoopLedger } | null): void {
  if (!current?.id) throw new Error('CURRENT Ledger 댓글 ID가 필요합니다')
  const payload = JSON.stringify({ body: encodeLedger(current.ledger) })
  execFileSync('gh', ['api', `repos/${repo}/issues/comments/${current.id}`, '--method', 'PATCH', '--input', '-'], {
    input: payload,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

/** Event History는 기존 댓글을 지우지 않고 새 댓글로만 추가한다. */
export function appendIssueEvent(gh: Gh, repo: string, issue: number, event: LoopEvent): void {
  const payload = JSON.stringify({ body: encodeEvent(event) })
  execFileSync('gh', ['api', `repos/${repo}/issues/${issue}/comments`, '--method', 'POST', '--input', '-'], {
    input: payload,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

/** 레거시 호환용. 새 코드에서는 CURRENT 갱신과 Event append를 분리한다. */
export function appendIssueLedger(gh: Gh, repo: string, issue: number, ledger: LoopLedger): void {
  appendIssueEvent(gh, repo, issue, {
    eventId: `legacy-${issue}-${ledger.attempts.length}-${ledger.headSha ?? 'unknown'}`,
    eventType: 'state_transition',
    issue,
    headSha: ledger.headSha,
    timestamp: new Date().toISOString(),
    nextState: ledger.state,
  })
}

export function loadBody(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

export function validateCurrentAgainstEvents(current: LoopLedger, events: LoopEvent[]): void {
  const last = events.at(-1)
  if (!last) return
  if (last.issue !== current.issue || (last.headSha && current.headSha && last.headSha !== current.headSha)) {
    throw new Error('CURRENT Ledger와 Event History가 일치하지 않습니다')
  }
  if (last.nextState && last.nextState !== current.state) {
    throw new Error('CURRENT Ledger의 상태가 마지막 이벤트와 다릅니다')
  }
}
