import { describe, expect, it } from 'vitest'
import { verifyDatabaseFiles } from '../../scripts/verify-env'

describe('Issue #4 — 02 검증 플랫폼 독립성', () => {
  it('검증 DB와 SQLite 부속 파일의 경로를 동일하게 계산한다', () => {
    const files = verifyDatabaseFiles()
    expect(files).toHaveLength(4)
    expect(files[0]).toMatch(/verify\.db$/)
    expect(files.slice(1)).toEqual([
      `${files[0]}-journal`,
      `${files[0]}-wal`,
      `${files[0]}-shm`,
    ])
  })
})
