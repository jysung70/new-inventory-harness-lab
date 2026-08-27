import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/StatusBadge'
import { PopupShipOut, type ShipRow } from '@/components/PopupShipOut'
import { PopupReport } from '@/components/PopupReport'
import { UnsettleButton } from '@/components/UnsettleButton'
import { getPopupDetail, popupPeriod, popupReport } from '@/lib/popup'
import { POPUP_STATUS, POPUP_STATUS_LABEL, type PopupStatus } from '@/lib/constants'
import { formatDate } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function PopupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getPopupDetail(Number(id))
  if (!detail) notFound()

  const { popup, totals, byProduct, popupLots, sourceLots, products } = detail
  const status = popup.status as PopupStatus
  const closed = status === POPUP_STATUS.CLOSED
  const onHand = popupLots.reduce((s, l) => s + l.quantity, 0)

  const header = (
    <>
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/popups" className="text-[14.5px] font-extrabold">
          ‹ {popup.name}
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={closed ? 'gray' : status === POPUP_STATUS.PREP ? 'amber' : 'acc'}>
            {POPUP_STATUS_LABEL[status]}
          </Badge>
          {detail.expired && <Badge tone="red">기한 지남</Badge>}
        </div>
      </header>
      <p className="border-b border-line bg-dim px-4 py-2.5 text-[11.5px] text-[#5b5570] tnum">
        {popupPeriod(popup.startDate, popup.endDate)} · {popup.sourceLocation.name}에서 반출
        {closed && popup.settledAt && ` · ${formatDate(popup.settledAt)} 정산`}
      </p>
    </>
  )

  // ───────── 정산 완료 — 리포트를 보여준다 (E3)
  if (closed) {
    return (
      <main className="pb-16">
        {header}
        <PopupReport report={popupReport(totals, byProduct)} />
        <UnsettleButton popupId={popup.id} />
      </main>
    )
  }

  // ───────── 진행 중 — 반출과 정산 진입
  const stockByProduct = new Map<number, typeof sourceLots>()
  for (const lot of sourceLots) {
    stockByProduct.set(lot.productId, [...(stockByProduct.get(lot.productId) ?? []), lot])
  }

  const rows: ShipRow[] = products
    .map((p) => {
      const lots = stockByProduct.get(p.id) ?? []
      const agg = byProduct.find((b) => b.productId === p.id)
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        planned: agg?.planned ?? 0,
        shipped: agg?.shipped ?? 0,
        sourceStock: lots.reduce((s, l) => s + l.quantity, 0),
        lots: lots.map((l) => ({ id: l.id, expiry: l.expiry, quantity: l.quantity })),
      }
    })
    .filter((r) => r.sourceStock > 0 || r.planned > 0)

  return (
    <main className="pb-32">
      {header}

      <div className="grid grid-cols-2 border-b border-line">
        <div className="border-r border-line px-4 py-3">
          <p className="text-[10.5px] text-sub">누적 반출</p>
          <p className="text-[22px] font-extrabold tnum">{totals.shipped.toLocaleString()}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10.5px] text-sub">현재 팝업 보유</p>
          <p className="text-[22px] font-extrabold text-acc tnum">{onHand.toLocaleString()}</p>
        </div>
      </div>

      {onHand > 0 && (
        <Link
          href={`/popups/${popup.id}/settle`}
          className="flex items-center justify-between border-b border-line bg-acc-soft px-4 py-3"
        >
          <span className="text-[13px] font-extrabold text-acc">
            행사가 끝났나요? 정산 시작 — 남은 실물로 판매량을 역산합니다
          </span>
          <span className="text-acc">›</span>
        </Link>
      )}

      {popupLots.length > 0 && (
        <>
          <p className="px-4 pb-1 pt-4 text-[10.5px] font-extrabold tracking-wider text-sub">
            팝업에 있는 재고 (유통기한별)
          </p>
          {popupLots.map((l) => (
            <div key={l.lotId} className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="text-[12.5px] font-bold">{l.name}</p>
              <p className="text-[11px] text-sub tnum">
                {formatDate(new Date(l.expiry))} · <b className="text-ink">{l.quantity}</b>
                {l.unit}
              </p>
            </div>
          ))}
        </>
      )}

      <PopupShipOut
        popupId={popup.id}
        rows={rows}
        sourceName={popup.sourceLocation.name}
        prefillPlan={status === POPUP_STATUS.PREP}
      />
    </main>
  )
}
