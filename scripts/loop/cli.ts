#!/usr/bin/env node
/**
 * 03-loop 명령줄 집행 수단.
 * 원본: docs/harness/03-loop.md
 * 이 명령은 상태를 기록하지만 소스 수정·커밋·푸시·승인·병합은 하지 않는다.
 */
import { ghCli, readIssueLedger, parseIssueMaxLoops, appendIssueLedger } from './ledger'
import { parseMaxLoops, type LoopLedger } from './state'

const args = process.argv.slice(2)
const command = args[0]
const value = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function requireValue(name: string): string {
  const result = value(name)
  if (!result) throw new Error(`${name} 값이 필요합니다`)
  return result
}

function usage(): never {
  console.error('사용법: npm run loop -- <init|status> --repo <owner/repo> --issue <번호>')
  process.exit(1)
}

if (!command || !['init', 'status'].includes(command)) usage()

try {
  const repo = requireValue('--repo')
  const issue = Number(requireValue('--issue'))
  if (!Number.isInteger(issue) || issue <= 0) throw new Error('--issue는 양의 정수여야 합니다')
  const gh = ghCli()
  const current = readIssueLedger(gh, repo, issue)

  if (command === 'status') {
    if (!current.ledger) throw new Error('Issue에 03-loop 원장이 없습니다')
    console.log(JSON.stringify(current.ledger, null, 2))
    process.exit(0)
  }

  if (current.ledger) throw new Error('Issue에 03-loop 원장이 이미 있습니다')
  const issueBody = gh(['api', `repos/${repo}/issues/${issue}`, '--jq', '.body'])
  const maxLoops = parseMaxLoops(parseIssueMaxLoops(issueBody))
  const ledger: LoopLedger = {
    schemaVersion: 1,
    issue,
    maxLoops,
    state: 'READY',
    consumedAttempts: 0,
    attempts: [],
  }
  appendIssueLedger(gh, repo, issue, ledger)
  console.log(`03-loop 원장을 Issue #${issue}에 초기화했습니다 (max-loops=${maxLoops})`)
} catch (error) {
  console.error(`03-loop 중단: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
