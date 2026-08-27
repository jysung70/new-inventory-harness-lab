/**
 * Architecture Check — 재고 변경이 applyMovement()를 거치는지 정적으로 검사한다.
 *
 * 원본: docs/06-architecture.md
 *   §2  "재고 수량을 바꾸는 코드는 lib/stock.ts의 applyMovement() 한 곳에만 존재한다.
 *        화면·액션은 이 함수를 부를 뿐, prisma.lot.update()를 직접 호출하지 않는다"
 *   §4.1 "반드시 prisma.$transaction() 안에서 호출한다"
 *        "이력 기록 — 항상 함께, 항상 같은 트랜잭션"
 *
 * 타입 검사로는 못 막는 것만 본다.
 * PrismaClient 는 PrismaTx 에 구조적으로 대입되므로 applyMovement(db, ...) 도 타입은 통과한다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 재고를 실제로 움직이는 쓰기 — 어디서든 applyMovement 를 거쳐야 한다 */
const MUTATING = 'create|createMany|update|updateMany|upsert'
/** 픽스처 정리용 삭제 — 시드·테스트가 자기가 만든 것을 지울 때만 허용한다 */
const DELETING = 'delete|deleteMany'

const WRITE_RE = new RegExp(`\\.\\s*(lot|movement)\\s*\\.\\s*(${MUTATING}|${DELETING})\\b`, 'i')
const MUTATE_RE = new RegExp(`\\.\\s*(lot|movement)\\s*\\.\\s*(${MUTATING})\\b`, 'i')
/** 트랜잭션이 아닌 클라이언트를 그대로 넘기는 호출 */
const LOOSE_TX_RE = /applyMovement\s*\(\s*(db|prisma)\b/

/** 재고 증감의 유일한 통로. 이 파일만 직접 쓸 수 있다 */
const GATEWAY = 'src/lib/stock.ts'

/** 앱 코드 — lot/movement 직접 쓰기를 일절 하지 않는다 */
const APP_DIRS = ['src']
/** 시드·테스트·도구 — 픽스처 정리(delete)는 허용, 재고를 만드는 쓰기는 금지 */
const FIXTURE_DIRS = ['prisma', 'tests', 'scripts']

const SKIP = ['src/generated', 'node_modules', '.next']

type Violation = { file: string; line: number; text: string; rule: string }

function repoPath(file: string): string {
  return file.replaceAll('\\', '/')
}

function walk(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (SKIP.some((s) => repoPath(full).startsWith(s))) continue
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(repoPath(full))
  }
  return out
}

/** 주석을 지운다 — 줄 번호는 유지한다 (주석 속 예시 코드에 걸리지 않게) */
function stripComments(source: string): string[] {
  let inBlock = false
  return source.split('\n').map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      if (inBlock) {
        if (line.startsWith('*/', i)) { inBlock = false; i++ }
        continue
      }
      if (line.startsWith('/*', i)) { inBlock = true; i++; continue }
      if (line.startsWith('//', i)) break
      out += line[i]
    }
    return out
  })
}

const violations: Violation[] = []

/** forbidden 이 null 이면 트랜잭션 규칙만 본다 (통로 자신) */
function check(file: string, forbidden: RegExp | null, rule: string) {
  const lines = stripComments(readFileSync(file, 'utf8'))
  lines.forEach((line, i) => {
    if (forbidden?.test(line)) violations.push({ file, line: i + 1, text: line.trim(), rule })
    if (LOOSE_TX_RE.test(line))
      violations.push({
        file,
        line: i + 1,
        text: line.trim(),
        rule: 'applyMovement 는 트랜잭션(tx)으로 호출한다 — db/prisma 를 그대로 넘길 수 없다',
      })
  })
}

const appFiles = APP_DIRS.flatMap(walk).filter((f) => f !== GATEWAY)
const fixtureFiles = FIXTURE_DIRS.flatMap(walk)

for (const f of appFiles) {
  check(f, WRITE_RE, `재고 변경은 ${GATEWAY} 의 applyMovement() 를 거친다 — lot/movement 직접 쓰기 금지`)
}
for (const f of fixtureFiles) {
  check(f, MUTATE_RE, `시드·테스트도 재고는 applyMovement() 로 만든다 — 정리용 delete 만 허용`)
}
// 통로 자신은 lot/movement 를 직접 쓴다. 다만 트랜잭션 규칙은 똑같이 적용받는다
check(GATEWAY, null, '')

const scanned = appFiles.length + fixtureFiles.length + 1

if (violations.length > 0) {
  console.error(`\n❌ Architecture Check 실패 — ${violations.length}건\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ${v.text}`)
    console.error(`    → ${v.rule}\n`)
  }
  console.error('원본: docs/06-architecture.md §2, §4.1\n')
  process.exit(1)
}

console.log(`✅ Architecture Check — 재고 변경이 applyMovement() 를 거친다 (${scanned}개 파일)`)
