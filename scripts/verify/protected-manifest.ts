/**
 * 보호 경로 승인 기록 — 공통 모듈.
 *
 * 원본: docs/harness/01-ssot.md §6 "보호 경로와 승인"
 *
 * 승인은 내용 해시로 기록한다. git 이력이나 브랜치에 기대지 않으므로
 * 얕은 클론(CI)에서도 로컬과 똑같이 동작한다.
 *
 * 승인은 **경로 단위**다. 사람이 지정한 범위의 경로만 기준선이 갱신되고,
 * 범위 밖 경로는 이전 승인 그대로 남는다 — 옆에 딸려온 변경이 함께 승인되지 않는다.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 보호 경로 — SSOT가 원본으로 등록한 것들. 끝이 '/' 면 디렉터리 안의 .ts 전부 */
export const PROTECTED = [
  'docs/01-requirements.md',
  'docs/06-architecture.md',
  'docs/harness/01-ssot.md',
  'docs/harness/02-verification.md',
  'prisma/schema.prisma',
  'scripts/verify/',
] as const

/** 승인 기록 자신. 검사 대상에서는 빠진다 — 기록이 기록을 검사할 수는 없다 */
export const MANIFEST_PATH = 'scripts/verify/protected.json'

export const MANIFEST_NOTE =
  '보호 경로 승인 기록 — docs/harness/01-ssot.md §6. 직접 편집하지 말고 npm run verify:approve 로 갱신한다'

/** OS에 관계없이 승인 기록은 저장소 상대 경로를 '/'로 보존한다. */
export function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\\\', '/')
}

/** 경로 하나에 대한 승인. 무엇을(hash) 누가 언제 왜 승인했는지를 경로마다 따로 남긴다 */
export type PathApproval = {
  hash: string
  approvedAt: string
  approvedBy: string
  reason: string
}

export type Manifest = {
  note: string
  paths: Record<string, PathApproval>
}

export function hashOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkTs(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 보호 경로를 실제 파일 목록으로 편다 */
export function expandProtected(): string[] {
  const files: string[] = []
  for (const entry of PROTECTED) {
    if (entry.endsWith('/')) {
      const dir = entry.slice(0, -1)
      if (existsSync(dir)) files.push(...walkTs(dir))
    } else if (existsSync(entry)) {
      files.push(entry)
    } else {
      files.push(entry) // 없는 파일도 목록에 넣는다 — 삭제를 잡기 위해
    }
  }
  return [...new Set(files.map(normalizeRepoPath))].filter((f) => f !== MANIFEST_PATH).sort()
}

export function currentHashes(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of expandProtected()) out[f] = existsSync(f) ? hashOf(f) : ''
  return out
}

/**
 * 기록을 읽는다. 경로마다 승인이 따로 남기 전의 옛 형식
 * (paths 가 경로→해시 문자열이고 승인 정보가 최상위에 하나만 있던 형식)도 읽어서 펴 준다.
 */
export function readManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    note?: string
    approvedAt?: string
    approvedBy?: string
    reason?: string
    paths?: Record<string, string | PathApproval>
  }
  const paths: Record<string, PathApproval> = {}
  for (const [rawFile, value] of Object.entries(raw.paths ?? {})) {
    const file = normalizeRepoPath(rawFile)
    paths[file] =
      typeof value === 'string'
        ? {
            hash: value,
            approvedAt: raw.approvedAt ?? '',
            approvedBy: raw.approvedBy ?? '알 수 없음',
            reason: raw.reason ?? '(사유 미기재)',
          }
        : value
  }
  return { note: raw.note ?? MANIFEST_NOTE, paths }
}

export function writeManifest(m: Manifest): void {
  const sorted = Object.fromEntries(Object.entries(m.paths).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ ...m, paths: sorted }, null, 2)}\n`)
}

/** 승인 범위로 지정할 수 있는 경로 — 지금 있는 보호 파일과 이미 승인된 경로의 합집합 */
export function knownPaths(manifest: Manifest | null): string[] {
  const set = new Set(expandProtected())
  if (manifest) for (const f of Object.keys(manifest.paths)) set.add(f)
  return [...set].sort()
}

/**
 * 사람이 --scope 로 지정한 것을 실제 경로 목록으로 편다.
 * 끝이 '/' 면 그 아래 보호 파일 전부를 가리킨다. 아무것도 못 맞히면 unknown 에 담아 돌려준다 —
 * 오타가 "범위 밖"으로 조용히 흘러가지 않게 한다.
 *
 * exact 는 사람이 파일 경로를 그대로 짚은 것만 담는다. 디렉터리로 쓸어 담은 것과 구별해야
 * 변경도 없는 파일의 승인 사유를 디렉터리 지정만으로 덮어쓰지 않는다.
 */
export function resolveScope(
  specs: string[],
  known: string[]
): { files: string[]; exact: Set<string>; unknown: string[] } {
  const files = new Set<string>()
  const exact = new Set<string>()
  const unknown: string[] = []
  for (const raw of specs) {
    const spec = raw.trim().replace(/^\.\//, '')
    if (!spec) continue
    const isDir = spec.endsWith('/')
    const matched = isDir ? known.filter((f) => f.startsWith(spec)) : known.filter((f) => f === spec)
    if (matched.length === 0) unknown.push(spec)
    else
      for (const f of matched) {
        files.add(f)
        if (!isDir) exact.add(f)
      }
  }
  return { files: [...files].sort(), exact, unknown }
}

/** 승인된 기준선과 지금 내용을 대조한다 */
export function diffAgainst(
  manifest: Manifest,
  current: Record<string, string>
): { changed: string[]; added: string[]; removed: string[] } {
  const approved = manifest.paths
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const [file, h] of Object.entries(current)) {
    if (!(file in approved)) {
      if (h !== '') added.push(file)
    } else if (h === '') removed.push(file)
    else if (approved[file].hash !== h) changed.push(file)
  }
  for (const file of Object.keys(approved)) {
    if (!(file in current)) removed.push(file)
  }

  return { changed: changed.sort(), added: added.sort(), removed: [...new Set(removed)].sort() }
}
