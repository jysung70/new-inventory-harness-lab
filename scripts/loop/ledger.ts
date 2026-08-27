/** Issue 댓글 원장 — 03-loop의 지속 상태 어댑터.
 * 원본: docs/harness/03-loop.md
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { LoopLedger } from './state'

export const LEDGER_MARKER = '<!-- inventory-harness:03-loop -->'
export const LEDGER_SCHEMA = 1

type Gh = (args: string[]) => string

export function encodeLedger(ledger: LoopLedger): string {
  return `${LEDGER_MARKER}\n<!-- schema: ${LEDGER_SCHEMA} -->\n\`\`\`json\n${JSON.stringify(ledger, null, 2)}\n\`\`\``
}

export function decodeLedger(body: string): LoopLedger | null {
  if (!body.includes(LEDGER_MARKER)) return null
  const match = body.match(/```json\n([\s\S]*?)\n```/)
  if (!match) throw new Error('03-loop 원장 JSON 블록을 찾을 수 없습니다')
  const value = JSON.parse(match[1]) as LoopLedger
  if (value.schemaVersion !== LEDGER_SCHEMA || !Array.isArray(value.attempts)) {
    throw new Error('지원하지 않는 03-loop 원장 형식입니다')
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

export function readIssueLedger(gh: Gh, repo: string, issue: number): { body: string; ledger: LoopLedger | null } {
  const raw = gh(['api', `repos/${repo}/issues/${issue}/comments`, '--paginate'])
  const comments = JSON.parse(raw) as { body: string }[]
  const marked = comments.filter((comment) => comment.body.includes(LEDGER_MARKER))
  if (marked.length > 1) throw new Error('03-loop 원장이 여러 개입니다')
  const body = marked[0]?.body ?? ''
  return { body, ledger: body ? decodeLedger(body) : null }
}

export function appendIssueLedger(gh: Gh, repo: string, issue: number, ledger: LoopLedger): void {
  const body = encodeLedger(ledger)
  const payload = JSON.stringify({ body })
  execFileSync('gh', ['api', `repos/${repo}/issues/${issue}/comments`, '--method', 'POST', '--input', '-'], {
    input: payload,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

export function loadBody(path: string): string {
  return readFileSync(path, 'utf8')
}
