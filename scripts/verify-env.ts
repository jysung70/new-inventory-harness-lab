import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const databaseUrl = process.env.DATABASE_URL ?? 'file:./prisma/verify.db'
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
const runner = process.execPath
const testRunner = process.execPath

export function verifyDatabaseFiles(): string[] {
  const databasePath = path.resolve(root, databaseUrl.replace(/^file:/, ''))
  return [databasePath, `${databasePath}-journal`, `${databasePath}-wal`, `${databasePath}-shm`]
}

export function runVerifyPrepare(): void {
  for (const file of verifyDatabaseFiles()) rmSync(file, { force: true })
  execFileSync(runner, [tsx, 'scripts/ensure-db.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
}

export function runVerifyTest(): void {
  execFileSync(testRunner, [vitest, 'run'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
}

const command = process.argv[2]
if (command === 'prepare') runVerifyPrepare()
else if (command === 'test') runVerifyTest()
else {
  console.error('사용법: tsx scripts/verify-env.ts <prepare|test>')
  process.exitCode = 1
}
