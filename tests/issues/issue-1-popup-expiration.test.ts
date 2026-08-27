import { describe, expect, it } from 'vitest'
import { isPopupExpired } from '@/lib/popup'
import { dateOnly } from '@/lib/date'
import { POPUP_STATUS } from '@/lib/constants'

describe('Issue #1 — 팝업 기한 지남 표시', () => {
  const endDate = dateOnly('2026-08-25')

  it('현재 날짜가 종료일 이후면 기한 지남으로 판정한다', () => {
    expect(isPopupExpired(endDate, dateOnly('2026-08-26'))).toBe(true)
  })

  it('현재 날짜가 종료일과 같으면 기한 지남으로 판정하지 않는다', () => {
    expect(isPopupExpired(endDate, dateOnly('2026-08-25'))).toBe(false)
  })

  it('현재 날짜가 종료일 이전이면 기한 지남으로 판정하지 않는다', () => {
    expect(isPopupExpired(endDate, dateOnly('2026-08-24'))).toBe(false)
  })

  it('기한 경과는 ACTIVE 상태와 정산 흐름의 상태 판정을 바꾸지 않는다', () => {
    const status = POPUP_STATUS.ACTIVE
    expect(isPopupExpired(endDate, dateOnly('2026-08-26'))).toBe(true)
    expect(status).toBe(POPUP_STATUS.ACTIVE)
  })

  it('정산 확정으로 CLOSED가 된 팝업의 상태 판정은 기한 경과와 무관하게 유지된다', () => {
    const status = POPUP_STATUS.CLOSED
    expect(isPopupExpired(endDate, dateOnly('2026-08-26'))).toBe(true)
    expect(status).toBe(POPUP_STATUS.CLOSED)
  })
})
