import Link from 'next/link'
import { Badge } from '@/components/StatusBadge'
import { getPopupList, popupPeriod } from '@/lib/popup'
import { POPUP_STATUS, POPUP_STATUS_LABEL, type PopupStatus } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const TONE: Record<PopupStatus, 'acc' | 'amber' | 'ok' | 'gray'> = {
  PREP: 'amber',
  ACTIVE: 'acc',
  SETTLING: 'amber',
  CLOSED: 'gray',
}

export default async function PopupsPage() {
  const popups = await getPopupList()
  const running = popups.filter((p) => p.status !== POPUP_STATUS.CLOSED)
  const closed = popups.filter((p) => p.status === POPUP_STATUS.CLOSED)

  return (
    <main className="pb-16">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-[14.5px] font-extrabold">
          ‹ 팝업
        </Link>
        <Link href="/popups/new" className="text-[11.5px] font-bold text-acc">
          ＋ 팝업 만들기
        </Link>
      </header>

      <p className="border-b border-line bg-dim px-4 py-2.5 text-[11.5px] leading-relaxed text-[#5b5570]">
        팝업은 <b>여러 번 반출했다가 마지막에 한 번 정산하는 임시 거점</b>입니다. 현장에서 판매를
        건별로 찍지 않고, 돌아온 실물 수량으로 판매량을 역산합니다.
      </p>

      {running.length === 0 && (
        <p className="px-4 py-12 text-center text-[13px] text-sub">진행 중인 팝업이 없습니다</p>
      )}

      {running.map((p) => (
        <Link key={p.id} href={`/popups/${p.id}`} className="block border-b border-line px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-bold">🎪 {p.name}</p>
              <p className="mt-[3px] text-[11px] text-sub tnum">
                {popupPeriod(p.startDate, p.endDate)} · 누적 반출 {p.shipped}개 · 현재 보유{' '}
                <b className="text-acc">{p.onHand}개</b>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={TONE[p.status as PopupStatus]}>
                {POPUP_STATUS_LABEL[p.status as PopupStatus]}
              </Badge>
              {p.expired && <Badge tone="red">기한 지남</Badge>}
              <span className="text-sub">›</span>
            </div>
          </div>
          <p className="mt-1.5 text-[10.5px] text-[#a9a3b8]">
            {p.status === POPUP_STATUS.PREP
              ? '반출서만 작성된 상태입니다. 아직 재고는 움직이지 않았습니다'
              : '행사 중 · 추가 반출과 정산을 여기서 합니다'}
          </p>
        </Link>
      ))}

      {closed.length > 0 && (
        <>
          <p className="px-4 pb-1 pt-5 text-[10.5px] font-extrabold tracking-wider text-sub">
            종료된 팝업
          </p>
          {closed.map((p) => {
            const consumed = p.sold + p.sample
            const rate = p.shipped > 0 ? Math.round((consumed / p.shipped) * 100) : 0
            return (
              <Link
                key={p.id}
                href={`/popups/${p.id}`}
                className="flex items-center justify-between border-b border-line px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold">{p.name}</p>
                    {p.expired && <Badge tone="red">기한 지남</Badge>}
                  </div>
                  <p className="mt-[3px] text-[11px] text-sub tnum">
                    반출 {p.shipped} · 판매 {p.sold} · 시식 {p.sample} · 반입 {p.returned}
                  </p>
                </div>
                <span className="text-[12.5px] font-extrabold text-acc tnum">소진율 {rate}%</span>
              </Link>
            )
          })}
        </>
      )}
    </main>
  )
}
