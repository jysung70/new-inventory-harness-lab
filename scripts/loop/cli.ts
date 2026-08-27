#!/usr/bin/env node
/** 03-loop 상태 기록 CLI. 원본: docs/harness/03-loop.md */
import { execFileSync } from 'node:child_process'
import { ghCli, readIssueState, parseIssueMaxLoops, writeCurrentLedger, appendIssueEvent } from './ledger'
import { parseMaxLoops, startAttempt, type LoopLedger } from './state'

const args = process.argv.slice(2)
const command = args[0]
const value = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const requireValue = (name: string) => {
  const result = value(name)
  if (!result) throw new Error(`${name} 값이 필요합니다`)
  return result
}

function usage(): never {
  console.error('사용법: npm run loop -- <init|status|start> --repo <owner/repo> --issue <번호>')
  process.exit(1)
}
if (!command || !['init', 'status', 'start'].includes(command)) usage()

try {
  const repo = requireValue('--repo')
  const issue = Number(requireValue('--issue'))
  if (!Number.isInteger(issue) || issue < 1) throw new Error('--issue는 양의 정수여야 합니다')
  const gh = ghCli()
  const current = readIssueState(gh, repo, issue)

  if (command === 'status') {
    if (!current.current) throw new Error('CURRENT Ledger가 없습니다')
    console.log(JSON.stringify({ current: current.current.ledger, events: current.events }, null, 2))
    process.exit(0)
  }
  if (command === 'init') {
    if (current.current) throw new Error('CURRENT Ledger가 이미 있습니다')
    const body = gh(['api', `repos/${repo}/issues/${issue}`, '--jq', '.body'])
    parseMaxLoops(parseIssueMaxLoops(body))
    throw new Error('CURRENT Ledger 초기화는 Issue #5 구현에서 명시적 사람 확인 후 수행해야 합니다')
  }
  if (!current.current) throw new Error('CURRENT Ledger가 없습니다')
  if (current.current.ledger.state !== 'READY' && current.current.ledger.state !== 'RETRYABLE_FAILURE') {
    throw new Error(`현재 상태(${current.current.ledger.state})에서는 시도를 시작할 수 없습니다`)
  }
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  const baseSha = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim()
  const startedAt = new Date().toISOString()
  const started = startAttempt(current.current.ledger, headSha, startedAt)
  const updated: LoopLedger = { ...started, repository: repo, branch, baseSha, headSha, changedPaths: [], nextAction: '구현 변경 후 npm run verify 실행' }
  writeCurrentLedger(gh, repo, issue, { ...current.current, ledger: updated })
  appendIssueEvent(gh, repo, issue, { eventId: `${issue}-attempt-${updated.attempts.at(-1)?.number}`, eventType: 'attempt_started', issue, attempt: updated.attempts.at(-1)?.number, headSha, timestamp: startedAt, nextState: 'IN_PROGRESS' })
  console.log(`Attempt ${updated.attempts.at(-1)?.number}/${updated.maxLoops}을 시작했습니다 (consumed=0)`)
} catch (error) {
  console.error(`03-loop 중단: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
