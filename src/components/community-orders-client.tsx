"use client";

import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, Search, PackageCheck, RefreshCw, X } from "lucide-react";
import { formatPrice } from "@/lib/products";

type CommunityPaymentStatus =
  | "unpaid"
  | "pending"
  | "approved"
  | "rejected"
  | "topup_required"
  | "overpaid_pending_refund"
  | "refund_completed";

type CommunityPaymentHistory = {
  id: string;
  batchId: string;
  bank: string;
  accountLast5: string;
  amount: number;
  expectedAmount: number;
  status: Exclude<CommunityPaymentStatus, "unpaid">;
  rejectionReason: string;
  submittedAt: string;
  reviewedAt: string;
  refundedAt: string;
  refundAmount: number;
  refundCompletedAt: string;
};

type CommunityOrderRow = {
  orderId: string;
  notebookName: string;
  paymentStatus: string;
  paymentSubmissionId: string;
  paymentBatchId: string;
  paymentBatchOrderIds: string[];
  paymentProductTotal: number;
  paymentDiscountAmount: number;
  paymentPayableAmount: number;
  paymentReviewStatus: CommunityPaymentStatus;
  paymentRejectionReason: string;
  paymentBank: string;
  paymentAccountLast5: string;
  paymentSubmittedAmount: number;
  paymentExpectedAmount: number;
  paymentSubmittedAt: string;
  paymentCumulativeReceived: number;
  paymentRemainingAmount: number;
  paymentOverpaidAmount: number;
  paymentHistory: CommunityPaymentHistory[];
  shipmentLocked: boolean;
  shipmentEligible: boolean;
  shipmentAllBoughtArrived: boolean;
  shipmentPaid: boolean;
  shipmentRequestId: string;
  shipmentRequestStatus: string;
  shipmentMethod: string;
  shipmentMarketplaceUrl: string;
  shipmentMarketplaceOrderRef: string;
  shipmentSubmittedAt: string;
  meetupEligible: boolean;
  meetupPaymentMethod: string;
  meetupDate: string;
  meetupStartTime: string;
  meetupEndTime: string;
  meetupLocation: string;
  arrivalStatus: string;
  orderStage: string;
  itemId: string;
  productName: string;
  variantSpec: string;
  quantity: number;
  unitPrice: number;
  itemSubtotal: number;
  snipeStatus: string;
  purchaseStatus: "bought" | "not_bought";
  itemArrivalStatus: "not_arrived" | "arrived" | "exception";
  groupTotal: number;
  boughtTotal: number;
  remitAmount: number;
  groupFirst: boolean;
};

type CommunityOrderGroup = {
  orderId: string;
  notebookName: string;
  paymentStatus: string;
  paymentSubmissionId: string;
  paymentBatchId: string;
  paymentBatchOrderIds: string[];
  paymentProductTotal: number;
  paymentDiscountAmount: number;
  paymentPayableAmount: number;
  paymentReviewStatus: CommunityPaymentStatus;
  paymentRejectionReason: string;
  paymentBank: string;
  paymentAccountLast5: string;
  paymentSubmittedAmount: number;
  paymentExpectedAmount: number;
  paymentSubmittedAt: string;
  paymentCumulativeReceived: number;
  paymentRemainingAmount: number;
  paymentOverpaidAmount: number;
  paymentHistory: CommunityPaymentHistory[];
  shipmentLocked: boolean;
  shipmentEligible: boolean;
  shipmentAllBoughtArrived: boolean;
  shipmentPaid: boolean;
  shipmentRequestId: string;
  shipmentRequestStatus: string;
  shipmentMethod: string;
  shipmentMarketplaceUrl: string;
  shipmentMarketplaceOrderRef: string;
  shipmentSubmittedAt: string;
  meetupEligible: boolean;
  meetupPaymentMethod: string;
  meetupDate: string;
  meetupStartTime: string;
  meetupEndTime: string;
  meetupLocation: string;
  arrivalStatus: string;
  orderStage: string;
  groupTotal: number;
  boughtTotal: number;
  remitAmount: number;
  items: CommunityOrderRow[];
};

type CommunityLineSession = {
  authenticated: boolean;
  displayName?: string;
  binding: { nickname: string; approvedAt?: string; updatedAt?: string } | null;
  application: {
    status: "not_requested" | "pending" | "approved";
    requestedNickname: string;
    updatedAt?: string;
  };
};

const ARRIVAL_STATUS_LABEL: Record<string, string> = {
  not_shipped: "未出貨",
  shipped_japan: "日本出貨",
  shipped_korea: "韓國出貨",
  arrived_taiwan: "到台灣",
};

const ORDER_STAGE_LABEL: Record<string, string> = {
  open: "開單",
  in_person: "面交",
};

const PAYMENT_BANK_OPTIONS = [
  { value: "ctbc", label: "中信", logo: "中" },
  { value: "cathay", label: "國泰", logo: "國" },
  { value: "fubon", label: "富邦", logo: "富" },
];

function groupRows(rows: CommunityOrderRow[]): CommunityOrderGroup[] {
  const groups: CommunityOrderGroup[] = [];
  const byId = new Map<string, CommunityOrderGroup>();
  for (const row of rows) {
    let group = byId.get(row.orderId);
    if (!group) {
      group = {
        orderId: row.orderId,
        notebookName: row.notebookName,
        paymentStatus: row.paymentStatus,
        paymentSubmissionId: row.paymentSubmissionId,
        paymentBatchId: row.paymentBatchId,
        paymentBatchOrderIds: row.paymentBatchOrderIds || [row.orderId],
        paymentProductTotal: row.paymentProductTotal,
        paymentDiscountAmount: row.paymentDiscountAmount,
        paymentPayableAmount: row.paymentPayableAmount,
        paymentReviewStatus: row.paymentReviewStatus,
        paymentRejectionReason: row.paymentRejectionReason,
        paymentBank: row.paymentBank,
        paymentAccountLast5: row.paymentAccountLast5,
        paymentSubmittedAmount: row.paymentSubmittedAmount,
        paymentExpectedAmount: row.paymentExpectedAmount,
        paymentSubmittedAt: row.paymentSubmittedAt,
        paymentCumulativeReceived: row.paymentCumulativeReceived,
        paymentRemainingAmount: row.paymentRemainingAmount,
        paymentOverpaidAmount: row.paymentOverpaidAmount,
        paymentHistory: row.paymentHistory || [],
        shipmentLocked: row.shipmentLocked,
        shipmentEligible: row.shipmentEligible,
        shipmentAllBoughtArrived: row.shipmentAllBoughtArrived,
        shipmentPaid: row.shipmentPaid,
        shipmentRequestId: row.shipmentRequestId,
        shipmentRequestStatus: row.shipmentRequestStatus,
        shipmentMethod: row.shipmentMethod,
        shipmentMarketplaceUrl: row.shipmentMarketplaceUrl,
        shipmentMarketplaceOrderRef: row.shipmentMarketplaceOrderRef,
        shipmentSubmittedAt: row.shipmentSubmittedAt,
        meetupEligible: row.meetupEligible,
        meetupPaymentMethod: row.meetupPaymentMethod,
        meetupDate: row.meetupDate,
        meetupStartTime: row.meetupStartTime,
        meetupEndTime: row.meetupEndTime,
        meetupLocation: row.meetupLocation,
        arrivalStatus: row.arrivalStatus,
        orderStage: row.orderStage,
        groupTotal: row.groupTotal,
        boughtTotal: row.boughtTotal,
        remitAmount: row.remitAmount,
        items: [],
      };
      byId.set(row.orderId, group);
      groups.push(group);
    }
    group.items.push(row);
  }
  return groups;
}

function snipeSummary(items: CommunityOrderRow[]): { label: string; tone: "amber" | "green" | "red" } {
  if (items.some((item) => item.snipeStatus === "lost")) return { label: "搶購失敗", tone: "red" };
  if (items.every((item) => item.snipeStatus === "won")) return { label: "已搶購", tone: "green" };
  return { label: "搶購中", tone: "amber" };
}

function StatusBadge({ label, tone }: { label: string; tone: "gray" | "amber" | "green" | "blue" | "purple" | "red" }) {
  const toneClass = {
    gray: "bg-gray-100 text-gray-500",
    amber: "bg-amber-100 text-amber-700",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-sky-100 text-sky-700",
    purple: "bg-violet-100 text-violet-700",
    red: "bg-red-100 text-red-600",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${toneClass}`}>{label}</span>;
}

function GroupStatusBadges({ group }: { group: CommunityOrderGroup }) {
  const snipe = snipeSummary(group.items);
  const arrivalTone = group.arrivalStatus === "arrived_taiwan" ? "green" : "gray";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge label={`搶購 ${snipe.label}`} tone={snipe.tone} />
      <StatusBadge label={`到貨 ${ARRIVAL_STATUS_LABEL[group.arrivalStatus] || group.arrivalStatus}`} tone={arrivalTone} />
      <StatusBadge label={`下單 ${ORDER_STAGE_LABEL[group.orderStage] || group.orderStage}`} tone="purple" />
    </div>
  );
}

function OrderCard({
  group,
  checked,
  onToggle,
  nickname,
  onPaymentSubmitted,
}: {
  group: CommunityOrderGroup;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  nickname: string;
  onPaymentSubmitted: () => Promise<void>;
}) {
  return (
    <article className="rounded-2xl border-2 border-penguin-peach bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          disabled={group.shipmentLocked || !group.shipmentAllBoughtArrived}
          className="mt-1 h-5 w-5 shrink-0 accent-penguin-pink-dark"
          aria-label={`選擇 ${group.notebookName}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-penguin-gray">{group.notebookName}</p>
          <ul className="mt-2 divide-y divide-dashed divide-penguin-peach/70">
            {group.items.map((item) => (
              <li key={item.itemId} className="grid gap-2 py-3 text-xs first:pt-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0 space-y-1">
                  <p className="font-bold text-penguin-gray">{item.productName}</p>
                  {item.variantSpec ? <p className="text-[11px] text-gray-400">{item.variantSpec}</p> : null}
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge
                      label={item.purchaseStatus === "not_bought" ? "沒買到" : "有買到"}
                      tone={item.purchaseStatus === "not_bought" ? "red" : "green"}
                    />
                    {item.purchaseStatus === "bought" ? (
                      <StatusBadge
                        label={{ not_arrived: "未到貨", arrived: "已到貨", exception: "異常" }[item.itemArrivalStatus] || "未到貨"}
                        tone={item.itemArrivalStatus === "arrived" ? "green" : item.itemArrivalStatus === "exception" ? "red" : "amber"}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="space-y-0.5 text-left tabular-nums text-gray-500 sm:text-right">
                  <p>數量 {item.quantity}</p>
                  <p>單價 {formatPrice(item.unitPrice)}</p>
                  <p className="font-black text-penguin-gray">小計 {formatPrice(item.itemSubtotal)}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-0.5 border-t border-penguin-peach pt-2 text-sm">
            <div className="flex items-center justify-between font-black text-penguin-gray">
              <span>有買到商品合計</span>
              <span className="tabular-nums">{formatPrice(group.boughtTotal)}</span>
            </div>
          </div>
          <div className="mt-3">
            <GroupStatusBadges group={group} />
          </div>
          {group.shipmentLocked ? (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
              <p className="font-black">
                {group.shipmentMethod === "face_to_face" ? "已預約面交" : "已申請出貨"} · {communityShipmentStatusLabel(group.shipmentRequestStatus)}
              </p>
              {group.shipmentMethod === "face_to_face" ? (
                <p className="mt-1">
                  {group.meetupDate} {group.meetupStartTime.slice(0, 5)}～{group.meetupEndTime.slice(0, 5)} · {group.meetupLocation}
                  <br />{group.meetupPaymentMethod === "pay_at_meetup" ? "面交付款" : "先匯款"}
                </p>
              ) : group.shipmentMarketplaceUrl ? (
                <a
                  href={group.shipmentMarketplaceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex font-black text-penguin-pink-dark underline underline-offset-2"
                >
                  前往賣貨便填寫取貨資料
                </a>
              ) : (
                <p className="mt-1">賣貨便建立中</p>
              )}
            </div>
          ) : null}
          <NotebookPaymentPanel group={group} nickname={nickname} onSubmitted={onPaymentSubmitted} />
        </div>
      </div>
    </article>
  );
}

function isPaymentSelectable(group: CommunityOrderGroup) {
  return ["unpaid", "rejected", "topup_required"].includes(group.paymentReviewStatus)
    && group.paymentRemainingAmount > 0;
}

function desktopItemStatus(item: CommunityOrderRow) {
  if (item.purchaseStatus === "not_bought") return "沒買到";
  return {
    arrived: "已到貨",
    exception: "異常",
    not_arrived: "未到貨",
  }[item.itemArrivalStatus] || "未到貨";
}

function DesktopOrderCard({
  group,
  tone,
  checked,
  selectable,
  onToggle,
}: {
  group: CommunityOrderGroup;
  tone: "unpaid" | "paid";
  checked: boolean;
  selectable: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const paymentLabel = desktopPaymentStatusLabel(group.paymentReviewStatus);
  return (
    <article className={`rounded-2xl border-2 p-4 ${tone === "paid" ? "border-emerald-200 bg-emerald-50/55" : "border-rose-200 bg-rose-50/55"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!selectable}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-penguin-pink-dark disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={`選擇 ${group.notebookName}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-penguin-gray">{group.notebookName}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span className={`rounded-full px-2 py-0.5 ${tone === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                  {tone === "paid" ? "已付款" : paymentLabel}
                </span>
                {tone === "paid" && !group.shipmentAllBoughtArrived ? <span className="text-amber-700">等待到貨</span> : null}
                {group.paymentReviewStatus === "topup_required" ? <span className="text-orange-700">尚需補款 {formatPrice(group.paymentRemainingAmount)}</span> : null}
                {group.paymentReviewStatus === "rejected" ? <span className="text-red-600">{group.paymentRejectionReason || "請重新確認付款資料"}</span> : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold text-gray-500">商品總金額</p>
              <p className="text-base font-black tabular-nums text-penguin-gray">{formatPrice(group.boughtTotal)}</p>
            </div>
          </div>

          <ul className="mt-3 divide-y divide-dashed divide-penguin-peach/80 border-t border-penguin-peach/80">
            {group.items.map((item) => (
              <li key={item.itemId} className="grid grid-cols-[minmax(0,1.45fr)_auto_auto_auto_auto] items-center gap-x-3 py-2 text-[11px] text-penguin-gray">
                <span className="min-w-0 truncate font-bold" title={item.variantSpec ? `${item.productName}｜${item.variantSpec}` : item.productName}>
                  {item.productName}{item.variantSpec ? `｜${item.variantSpec}` : ""}
                </span>
                <span className="whitespace-nowrap">×{item.quantity}</span>
                {item.purchaseStatus === "not_bought" ? (
                  <span className="col-span-2 whitespace-nowrap font-bold text-gray-400">不計入付款</span>
                ) : (
                  <>
                    <span className="whitespace-nowrap">單價 {formatPrice(item.unitPrice)}</span>
                    <span className="whitespace-nowrap font-black">小計 {formatPrice(item.itemSubtotal)}</span>
                  </>
                )}
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-black ${item.purchaseStatus === "not_bought" || item.itemArrivalStatus === "exception" ? "bg-red-100 text-red-600" : item.itemArrivalStatus === "arrived" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {desktopItemStatus(item)}
                </span>
              </li>
            ))}
          </ul>

          {group.shipmentLocked ? (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-700">
              <p className="font-black">{group.shipmentMethod === "face_to_face" ? "已預約面交" : "已申請出貨"} · {communityShipmentStatusLabel(group.shipmentRequestStatus)}</p>
              {group.shipmentMethod === "face_to_face" ? (
                <p>{group.meetupDate} {group.meetupStartTime.slice(0, 5)}～{group.meetupEndTime.slice(0, 5)} · {group.meetupLocation}</p>
              ) : null}
            </div>
          ) : null}

          {group.paymentHistory.length > 0 ? (
            <details className="mt-2 text-[11px] text-gray-500">
              <summary className="cursor-pointer font-black text-penguin-gray">付款紀錄 {group.paymentHistory.length} 筆</summary>
              <div className="mt-1 space-y-1">
                {group.paymentHistory.map((payment) => (
                  <p key={payment.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/80 px-2 py-1.5">
                    <span>{communityPaymentBankLabel(payment.bank)} · {communityPaymentStatusLabel(payment.status)}</span>
                    <span className="font-black tabular-nums text-penguin-gray">{formatPrice(payment.amount)}</span>
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DesktopCombinedPaymentPanel({
  groups,
  nickname,
  onSubmitted,
}: {
  groups: CommunityOrderGroup[];
  nickname: string;
  onSubmitted: () => Promise<void>;
}) {
  const existingBatchIds = [...new Set(groups.map((group) => group.paymentBatchId).filter(Boolean))];
  const freshGroups = groups.filter((group) => !group.paymentBatchId);
  const selectedOrderIds = [...new Set(groups.map((group) => group.orderId))];
  const existingBatchOrderIds = groups.find((group) => group.paymentBatchId)?.paymentBatchOrderIds || [];
  const isExistingBatch = existingBatchIds.length === 1 && freshGroups.length === 0;
  const completeExistingBatch = !isExistingBatch || (
    existingBatchOrderIds.length === selectedOrderIds.length
    && existingBatchOrderIds.every((orderId) => selectedOrderIds.includes(orderId))
  );
  const validSelection = groups.length > 0
    && existingBatchIds.length <= 1
    && !(existingBatchIds.length > 0 && freshGroups.length > 0)
    && completeExistingBatch;
  const productTotal = isExistingBatch
    ? groups.reduce((sum, group) => sum + group.paymentProductTotal, 0)
    : groups.reduce((sum, group) => sum + group.boughtTotal, 0);
  const discountTotal = isExistingBatch
    ? groups.reduce((sum, group) => sum + group.paymentDiscountAmount, 0)
    : groups.reduce((sum, group) => sum + Math.min(20, group.boughtTotal), 0);
  const total = isExistingBatch
    ? (groups[0]?.paymentRemainingAmount || 0)
    : Math.max(productTotal - discountTotal, 0);
  const submitOrderIds = isExistingBatch ? existingBatchOrderIds : selectedOrderIds;
  const [bank, setBank] = useState("ctbc");
  const [amount, setAmount] = useState("0");
  const [last5, setLast5] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setAmount(String(total)), [total]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountNumber = Number(amount);
    if (!validSelection || total <= 0 || submitting || !Number.isFinite(amountNumber) || amountNumber <= 0 || !/^\d{5}$/.test(last5)) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/community/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, orderIds: submitOrderIds, bank, accountLast5: last5, amount: amountNumber }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "付款資料送出失敗，請稍後再試。");
      setLast5("");
      await onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "付款資料送出失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border-2 border-rose-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-penguin-gray">付款資料</h3>
          <p className="mt-0.5 text-[11px] font-bold text-gray-500">{groups.length ? `已選 ${groups.length} 個系列` : "請先選擇要付款的系列"}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-gray-500">本次應付總額</p>
          <p className="text-xl font-black tabular-nums text-penguin-pink-dark">{formatPrice(total)}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-gray-600">
        <div><dt>商品總金額</dt><dd className="mt-0.5 font-black tabular-nums text-penguin-gray">{formatPrice(productTotal)}</dd></div>
        <div><dt>記事本折抵</dt><dd className="mt-0.5 font-black tabular-nums text-penguin-pink-dark">-{formatPrice(discountTotal)}{!isExistingBatch && groups.length ? `（${groups.length} 本 × NT$20）` : ""}</dd></div>
        <div><dt>本次匯款</dt><dd className="mt-0.5 font-black tabular-nums text-penguin-gray">{formatPrice(total)}</dd></div>
      </dl>
      {!validSelection && groups.length ? <p className="mt-2 text-xs font-bold text-red-500">補款需完整選取同一付款批次的全部記事本，且不可混入其他批次。</p> : null}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {PAYMENT_BANK_OPTIONS.map((option) => (
          <button key={option.value} type="button" onClick={() => setBank(option.value)} className={`rounded-xl border-2 px-2 py-2 text-xs font-black ${bank === option.value ? "border-penguin-pink-dark bg-penguin-pink-light text-penguin-pink-dark" : "border-penguin-peach bg-white text-penguin-gray"}`}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-black text-penguin-gray">實際匯款金額<input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 h-10 w-full rounded-xl border-2 border-penguin-peach px-3 text-sm font-bold tabular-nums outline-none focus:border-penguin-pink-dark" /></label>
        <label className="text-xs font-black text-penguin-gray">匯款後 5 碼<input type="text" inputMode="numeric" maxLength={5} value={last5} onChange={(event) => setLast5(event.target.value.replace(/\D/g, "").slice(0, 5))} className="mt-1 h-10 w-full rounded-xl border-2 border-penguin-peach px-3 text-sm font-bold tabular-nums outline-none focus:border-penguin-pink-dark" /></label>
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-red-500">{error}</p> : null}
      <button type="submit" disabled={!validSelection || total <= 0 || submitting || !/^\d{5}$/.test(last5) || !Number.isFinite(Number(amount)) || Number(amount) <= 0} className="mt-3 w-full rounded-full bg-penguin-pink-dark px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? "送出中..." : "送出付款資料"}
      </button>
    </form>
  );
}

function NotebookPaymentPanel({
  group,
  nickname,
  onSubmitted,
}: {
  group: CommunityOrderGroup;
  nickname: string;
  onSubmitted: () => Promise<void>;
}) {
  const [bank, setBank] = useState("ctbc");
  const [amount, setAmount] = useState(String(group.paymentRemainingAmount || group.boughtTotal));
  const [last5, setLast5] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const status = group.paymentReviewStatus || "unpaid";
  const canSubmit = (status === "unpaid" || status === "rejected" || status === "topup_required")
    && group.paymentRemainingAmount > 0;

  useEffect(() => {
    if (canSubmit) setAmount(String(group.paymentRemainingAmount || group.boughtTotal));
  }, [canSubmit, group.boughtTotal, group.paymentRemainingAmount]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountNumber = Number(amount);
    if (!canSubmit || submitting || !Number.isFinite(amountNumber) || amountNumber <= 0 || !/^\d{5}$/.test(last5)) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/community/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, orderIds: group.paymentBatchOrderIds?.length ? group.paymentBatchOrderIds : [group.orderId], bank, accountLast5: last5, amount: amountNumber }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "付款資料送出失敗，請稍後再試。");
      await onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "付款資料送出失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-penguin-peach bg-penguin-cream/45 p-3">
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
          <span className="font-black text-penguin-gray">應付總額</span>
          <span className="font-black tabular-nums text-penguin-pink-dark">{formatPrice(group.paymentExpectedAmount || Math.max(group.boughtTotal - Math.min(20, group.boughtTotal), 0))}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
          <span className="font-black text-penguin-gray">累計已收</span>
          <span className="font-black tabular-nums text-penguin-gray">{formatPrice(group.paymentCumulativeReceived)}</span>
        </div>
      </div>

      {status === "pending" ? (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">付款資料已送出，等待審核</div>
      ) : status === "approved" ? (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">付款已核准</div>
      ) : status === "overpaid_pending_refund" ? (
        <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
          多匯待退款：{formatPrice(group.paymentOverpaidAmount)}
        </div>
      ) : status === "refund_completed" ? (
        <div className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">
          多匯退款已完成：{formatPrice(group.paymentOverpaidAmount)}
        </div>
      ) : group.boughtTotal <= 0 ? (
        <p className="mt-3 text-xs font-bold text-gray-500">目前沒有需要付款的商品。</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          {status === "topup_required" ? (
            <div className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700">
              尚需補款 <span className="font-black">{formatPrice(group.paymentRemainingAmount)}</span>
            </div>
          ) : null}
          {status === "rejected" ? (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <p className="font-black">審核退回</p>
              <p className="mt-0.5">原因：{group.paymentRejectionReason || "請重新確認付款資料。"}</p>
            </div>
          ) : null}
          <div>
            <p className="mb-1.5 text-xs font-black text-penguin-gray">選擇匯款銀行</p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_BANK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBank(option.value)}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-xs font-black transition ${bank === option.value ? "border-penguin-pink-dark bg-penguin-pink-light text-penguin-pink-dark" : "border-penguin-peach bg-white text-penguin-gray"}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[10px] shadow-sm" aria-hidden="true">{option.logo}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-black text-penguin-gray">
              實際匯款金額
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold tabular-nums outline-none focus:border-penguin-pink-dark"
              />
            </label>
            <label className="text-xs font-black text-penguin-gray">
              匯款後 5 碼
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={last5}
                onChange={(event) => setLast5(event.target.value.replace(/\D/g, "").slice(0, 5))}
                className="mt-1 h-10 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold tabular-nums outline-none focus:border-penguin-pink-dark"
              />
            </label>
          </div>
          {error ? <p className="text-xs font-bold text-red-500">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !/^\d{5}$/.test(last5) || !Number.isFinite(Number(amount)) || Number(amount) <= 0}
            className="w-full rounded-full bg-penguin-pink-dark px-4 py-2.5 text-sm font-black text-white transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "送出中..." : status === "topup_required" ? "送出補款資料" : status === "rejected" ? "重新送出付款資料" : "送出付款資料"}
          </button>
        </form>
      )}

      {group.paymentHistory.length > 0 ? (
        <div className="mt-4 border-t border-penguin-peach pt-3">
          <p className="text-xs font-black text-penguin-gray">付款紀錄</p>
          <div className="mt-2 space-y-2">
            {group.paymentHistory.map((payment) => (
              <div key={payment.id} className="rounded-xl bg-white px-3 py-2 text-[11px] text-gray-500">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-penguin-gray">
                    {communityPaymentBankLabel(payment.bank)} · 後五碼 {payment.accountLast5}
                  </span>
                  <span className="font-black tabular-nums text-penguin-gray">{formatPrice(payment.amount)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span>送出 {formatCommunityPaymentTime(payment.submittedAt)}</span>
                  <span className="font-black">{communityPaymentStatusLabel(payment.status)}</span>
                </div>
                {payment.reviewedAt ? <p className="mt-1">審核 {formatCommunityPaymentTime(payment.reviewedAt)}</p> : null}
                {payment.rejectionReason ? <p className="mt-1 text-red-500">退回原因：{payment.rejectionReason}</p> : null}
                {payment.refundAmount > 0 ? (
                  <p className="mt-1 text-violet-600">
                    退款 {formatPrice(payment.refundAmount)} · {formatCommunityPaymentTime(payment.refundCompletedAt)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function communityPaymentBankLabel(value: string) {
  if (value === "meetup") return "面交付款";
  return PAYMENT_BANK_OPTIONS.find((option) => option.value === value)?.label || value;
}

function communityPaymentStatusLabel(value: CommunityPaymentHistory["status"]) {
  return {
    pending: "待審核",
    approved: "已付款",
    rejected: "審核退回",
    topup_required: "需補款",
    overpaid_pending_refund: "多匯待退款",
    refund_completed: "退款完成",
  }[value];
}

function desktopPaymentStatusLabel(value: CommunityPaymentStatus) {
  if (value === "unpaid") return "未付款";
  return communityPaymentStatusLabel(value);
}

function formatCommunityPaymentTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function communityShipmentStatusLabel(value: string) {
  return {
    pending: "待處理",
    accepted: "已建立寄件／已受理",
    confirmed: "已確認",
    completed: "已完成",
    cancelled: "已取消",
  }[value] || value || "處理中";
}

export function CommunityOrdersClient() {
  const [nickname, setNickname] = useState("");
  const [searchedNickname, setSearchedNickname] = useState("");
  const [groups, setGroups] = useState<CommunityOrderGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [desktopUnpaidSelected, setDesktopUnpaidSelected] = useState<Set<string>>(new Set());
  const [desktopPaidSelected, setDesktopPaidSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [meetupOpen, setMeetupOpen] = useState(false);
  const [fulfillmentGroups, setFulfillmentGroups] = useState<CommunityOrderGroup[]>([]);
  const [lineSession, setLineSession] = useState<CommunityLineSession | null>(null);
  const [lineLoading, setLineLoading] = useState(true);
  const [lineError, setLineError] = useState("");
  const [bindingBusy, setBindingBusy] = useState(false);
  const [changingBinding, setChangingBinding] = useState(false);

  const selectableGroups = useMemo(
    () => (groups || []).filter((group) => !group.shipmentLocked && group.shipmentAllBoughtArrived),
    [groups],
  );
  const allSelected = selectableGroups.length > 0 && selectableGroups.every((group) => selected.has(group.orderId));

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/community/orders?nickname=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "查詢失敗，請稍後再試。");
      const rows = Array.isArray(result.rows) ? (result.rows as CommunityOrderRow[]) : [];
      setGroups(groupRows(rows));
      setSelected(new Set());
      setDesktopUnpaidSelected(new Set());
      setDesktopPaidSelected(new Set());
      setSearchedNickname(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試。");
      setGroups(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLineSession() {
      try {
        const lineStatus = new URL(window.location.href).searchParams.get("line");
        if (lineStatus === "not-configured") setLineError("LINE 登入尚未完成設定，請稍後再試。");
        if (lineStatus === "invalid-state") setLineError("LINE 登入已逾時，請重新登入。");
        if (lineStatus === "login-failed") setLineError("LINE 登入失敗，請重新再試一次。");
        if (lineStatus) window.history.replaceState({}, "", window.location.pathname);
        const response = await fetch("/api/community/line/session", { cache: "no-store" });
        const result = await response.json().catch(() => null) as (CommunityLineSession & { ok?: boolean; error?: string }) | null;
        if (!response.ok || !result?.ok) throw new Error(result?.error || "LINE 登入狀態讀取失敗。");
        if (!active) return;
        const nextSession: CommunityLineSession = {
          authenticated: Boolean(result.authenticated),
          displayName: result.displayName,
          binding: result.binding,
          application: result.application || { status: "not_requested", requestedNickname: "" },
        };
        setLineSession(nextSession);
        if (nextSession.binding?.nickname) {
          setNickname(nextSession.binding.nickname);
        } else if (nextSession.application.requestedNickname) {
          setNickname(nextSession.application.requestedNickname);
        }
      } catch (sessionError) {
        if (active) setLineError(sessionError instanceof Error ? sessionError.message : "LINE 登入狀態讀取失敗。");
      } finally {
        if (active) setLineLoading(false);
      }
    }
    loadLineSession();
    return () => {
      active = false;
    };
  }, []);

  async function handleApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed || bindingBusy) return;
    setBindingBusy(true);
    setLineError("");
    try {
      const response = await fetch("/api/community/line/session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: trimmed }),
      });
      const result = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        application?: CommunityLineSession["application"];
      } | null;
      if (!response.ok || !result?.ok || result.application?.status !== "pending") {
        throw new Error(result?.error || "送出審核失敗，請稍後再試。");
      }
      const application = result.application;
      setNickname(application.requestedNickname);
      setLineSession((current) => ({
        authenticated: true,
        displayName: current?.displayName,
        binding: current?.binding || null,
        application,
      }));
      setChangingBinding(false);
      setGroups(null);
      setSearchedNickname("");
    } catch (bindError) {
      setLineError(bindError instanceof Error ? bindError.message : "送出審核失敗，請稍後再試。");
    } finally {
      setBindingBusy(false);
    }
  }

  function toggleGroup(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(selectableGroups.map((group) => group.orderId)) : new Set());
  }

  const selectedGroups = useMemo(() => {
    if (!groups) return [];
    return groups.filter((group) => selected.has(group.orderId));
  }, [groups, selected]);

  const desktopUnpaidGroups = useMemo(
    () => (groups || []).filter((group) => !group.shipmentPaid),
    [groups],
  );
  const desktopPaidGroups = useMemo(
    () => (groups || []).filter((group) => group.shipmentPaid),
    [groups],
  );
  const desktopPayableGroups = useMemo(
    () => desktopUnpaidGroups.filter((group) => isPaymentSelectable(group)),
    [desktopUnpaidGroups],
  );
  const desktopFulfillableGroups = useMemo(
    () => desktopPaidGroups.filter((group) => group.shipmentAllBoughtArrived && !group.shipmentLocked),
    [desktopPaidGroups],
  );
  const selectedDesktopUnpaidGroups = useMemo(
    () => desktopUnpaidGroups.filter((group) => desktopUnpaidSelected.has(group.orderId)),
    [desktopUnpaidGroups, desktopUnpaidSelected],
  );
  const selectedDesktopPaidGroups = useMemo(
    () => desktopPaidGroups.filter((group) => desktopPaidSelected.has(group.orderId)),
    [desktopPaidGroups, desktopPaidSelected],
  );
  const allDesktopUnpaidSelected = desktopPayableGroups.length > 0
    && desktopPayableGroups.every((group) => desktopUnpaidSelected.has(group.orderId));
  const allDesktopPaidSelected = desktopFulfillableGroups.length > 0
    && desktopFulfillableGroups.every((group) => desktopPaidSelected.has(group.orderId));

  const selectedNotArrived = selectedGroups.filter((group) => !group.shipmentAllBoughtArrived);
  const selectedHasUnpaid = selectedGroups.some((group) => !group.shipmentPaid);
  const sevenElevenEnabled = selectedGroups.length > 0 && selectedGroups.every((group) => group.shipmentEligible);
  const faceToFaceEnabled = selectedGroups.length > 0 && selectedGroups.every((group) => group.meetupEligible);

  function handleShipClick() {
    if (!sevenElevenEnabled) return;
    setFulfillmentGroups(selectedGroups);
    setShipmentOpen(true);
  }

  function handleMeetupClick() {
    if (!faceToFaceEnabled) return;
    setFulfillmentGroups(selectedGroups);
    setMeetupOpen(true);
  }

  function toggleDesktopSelection(
    setter: Dispatch<SetStateAction<Set<string>>>,
    orderId: string,
    checked: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleDesktopUnpaidGroup(group: CommunityOrderGroup, checked: boolean) {
    const relatedOrderIds = group.paymentBatchId ? group.paymentBatchOrderIds : [group.orderId];
    setDesktopUnpaidSelected((current) => {
      const next = new Set(current);
      for (const orderId of relatedOrderIds) {
        if (checked) next.add(orderId);
        else next.delete(orderId);
      }
      return next;
    });
  }

  function openDesktopShipment() {
    if (!selectedDesktopPaidGroups.length || !selectedDesktopPaidGroups.every((group) => group.shipmentEligible)) return;
    setFulfillmentGroups(selectedDesktopPaidGroups);
    setShipmentOpen(true);
  }

  function openDesktopMeetup() {
    if (!selectedDesktopPaidGroups.length || !selectedDesktopPaidGroups.every((group) => group.meetupEligible)) return;
    setFulfillmentGroups(selectedDesktopPaidGroups);
    setMeetupOpen(true);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-8 sm:px-6 lg:max-w-7xl lg:px-8">
      <div className="mb-6 text-center">
        <p className="text-xs font-black text-penguin-pink-dark">社群下單查詢</p>
        <h1 className="mt-1 text-3xl font-black text-penguin-gray sm:text-4xl">社群訂單</h1>
        <p className="mt-2 text-sm font-bold text-gray-500">使用 LINE 登入，社群暱稱審核通過後即可查詢訂單。</p>
      </div>

      <section className="mx-auto max-w-xl rounded-3xl border-2 border-penguin-peach bg-white p-4 shadow-sm sm:p-5">
        {lineLoading ? (
          <p className="text-center text-sm font-bold text-gray-500">正在確認 LINE 登入狀態...</p>
        ) : !lineSession?.authenticated ? (
          <div className="text-center">
            <p className="text-sm font-black text-penguin-gray">先用 LINE 登入，才能查看社群訂單</p>
            <p className="mt-1 text-xs font-bold text-gray-500">第一次登入後，送出社群暱稱等待審核。</p>
            <form action="/api/community/line/start" method="get" className="mt-4">
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#06C755] px-7 text-sm font-black text-white shadow-md transition hover:bg-[#05b94e]"
              >
                <Link2 size={17} />
                使用 LINE 登入
              </button>
            </form>
          </div>
        ) : changingBinding || (!lineSession.binding && lineSession.application.status !== "pending") ? (
          <form onSubmit={handleApplication}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-penguin-gray">
                  {changingBinding ? "更換綁定暱稱" : "LINE 登入成功"}
                </p>
                <p className="mt-0.5 text-xs font-bold text-gray-500">
                  {lineSession.displayName ? `${lineSession.displayName}，` : ""}請輸入社群下單時使用的暱稱。
                </p>
              </div>
              {changingBinding ? (
                <button
                  type="button"
                  onClick={() => {
                    setChangingBinding(false);
                    setNickname(lineSession.binding?.nickname || "");
                    setLineError("");
                  }}
                  className="shrink-0 text-xs font-black text-gray-400 hover:text-penguin-gray"
                >
                  取消
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="輸入你的社群暱稱"
                  className="h-12 w-full rounded-full border-2 border-penguin-peach bg-white pl-11 pr-4 text-sm font-bold text-penguin-gray outline-none focus:border-penguin-pink-dark"
                />
              </div>
              <button
                type="submit"
                disabled={bindingBusy || !nickname.trim()}
                className="h-12 shrink-0 rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bindingBusy ? "送出中..." : "送出審核"}
              </button>
            </div>
          </form>
        ) : !lineSession.binding && lineSession.application.status === "pending" ? (
          <div className="text-center">
            <p className="text-sm font-black text-penguin-gray">LINE 登入成功</p>
            <p className="mt-2 text-lg font-black text-penguin-pink-dark">等待審核</p>
            <p className="mt-1 text-sm font-bold text-gray-500">
              申請暱稱：{lineSession.application.requestedNickname}
            </p>
            <p className="mt-2 text-xs font-bold text-gray-400">審核通過後才能使用這個暱稱查詢訂單。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-bold text-gray-500">已綁定社群暱稱</p>
              <p className="mt-0.5 text-lg font-black text-penguin-gray">{lineSession.binding?.nickname}</p>
              {lineSession.application.status === "pending" ? (
                <p className="mt-1 text-xs font-bold text-amber-600">
                  更換申請「{lineSession.application.requestedNickname}」等待審核
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={loading}
                onClick={() => lineSession.binding?.nickname && runSearch(lineSession.binding.nickname)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Search size={16} />
                {loading ? "查詢中..." : "查詢訂單"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNickname(lineSession.application.requestedNickname || lineSession.binding?.nickname || "");
                  setChangingBinding(true);
                  setLineError("");
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border-2 border-penguin-peach bg-white px-4 text-xs font-black text-penguin-pink-dark transition hover:bg-penguin-pink-light"
              >
                <RefreshCw size={14} />
                更換綁定暱稱
              </button>
            </div>
          </div>
        )}
      </section>

      {lineError ? (
        <p className="mx-auto mt-3 max-w-xl text-center text-sm font-bold text-red-500">{lineError}</p>
      ) : null}

      {error ? (
        <p className="mx-auto mt-6 max-w-xl text-center text-sm font-bold text-red-500">{error}</p>
      ) : null}

      {groups !== null && !error ? (
        groups.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-500">你沒有任何下單的商品喔</p>
          </div>
        ) : (
          <section className="mt-8 pb-28 sm:pb-0">
            <div className="hidden items-start gap-6 lg:grid lg:grid-cols-2">
              <section className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-rose-200 bg-rose-50/70 px-4 py-3">
                  <div>
                    <h2 className="text-lg font-black text-penguin-gray">未付款</h2>
                    <p className="text-[11px] font-bold text-gray-500">選擇要一起提交付款的系列</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-penguin-gray">
                    <input
                      type="checkbox"
                      checked={allDesktopUnpaidSelected}
                      disabled={desktopPayableGroups.length === 0}
                      onChange={(event) => setDesktopUnpaidSelected(event.target.checked ? new Set(desktopPayableGroups.map((group) => group.orderId)) : new Set())}
                      className="h-4 w-4 accent-penguin-pink-dark disabled:cursor-not-allowed disabled:opacity-45"
                    />
                    全選可付款
                  </label>
                </div>
                <div className="space-y-3">
                  {desktopUnpaidGroups.length ? desktopUnpaidGroups.map((group) => (
                    <DesktopOrderCard
                      key={group.orderId}
                      group={group}
                      tone="unpaid"
                      checked={desktopUnpaidSelected.has(group.orderId)}
                      selectable={isPaymentSelectable(group)}
                      onToggle={(checked) => toggleDesktopUnpaidGroup(group, checked)}
                    />
                  )) : (
                    <div className="rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/40 px-4 py-8 text-center text-sm font-bold text-gray-500">目前沒有未付款系列</div>
                  )}
                </div>
                <div className="mt-4">
                  <DesktopCombinedPaymentPanel
                    groups={selectedDesktopUnpaidGroups}
                    nickname={searchedNickname}
                    onSubmitted={() => runSearch(searchedNickname)}
                  />
                </div>
              </section>

              <section className="min-w-0">
                <div className="mb-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-penguin-gray">已付款</h2>
                      <p className="text-[11px] font-bold text-gray-500">只可選擇已到貨且未鎖定的系列</p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-penguin-gray">
                      <input
                        type="checkbox"
                        checked={allDesktopPaidSelected}
                        disabled={desktopFulfillableGroups.length === 0}
                        onChange={(event) => setDesktopPaidSelected(event.target.checked ? new Set(desktopFulfillableGroups.map((group) => group.orderId)) : new Set())}
                        className="h-4 w-4 accent-penguin-pink-dark disabled:cursor-not-allowed disabled:opacity-45"
                      />
                      全選可出貨
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-200 pt-3">
                    <p className="text-xs font-black text-penguin-gray">已選 {selectedDesktopPaidGroups.length} 個系列</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={selectedDesktopPaidGroups.length === 0}
                        onClick={openDesktopShipment}
                        className="inline-flex items-center gap-1.5 rounded-full border-2 border-penguin-pink-dark bg-white px-4 py-2 text-xs font-black text-penguin-pink-dark disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <PackageCheck size={14} />
                        7-11 出貨
                      </button>
                      <button
                        type="button"
                        disabled={selectedDesktopPaidGroups.length === 0}
                        onClick={openDesktopMeetup}
                        className="rounded-full border-2 border-gray-300 bg-white px-4 py-2 text-xs font-black text-penguin-gray disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        面交
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {desktopPaidGroups.length ? desktopPaidGroups.map((group) => {
                    const selectable = group.shipmentAllBoughtArrived && !group.shipmentLocked;
                    return (
                      <DesktopOrderCard
                        key={group.orderId}
                        group={group}
                        tone="paid"
                        checked={desktopPaidSelected.has(group.orderId)}
                        selectable={selectable}
                        onToggle={(checked) => toggleDesktopSelection(setDesktopPaidSelected, group.orderId, checked)}
                      />
                    );
                  }) : (
                    <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-8 text-center text-sm font-bold text-gray-500">目前沒有已付款系列</div>
                  )}
                </div>
              </section>
            </div>

            <div className="lg:hidden">
            {/* Existing mobile/tablet layout remains unchanged. */}
            <div className="hidden items-center justify-between gap-3 rounded-t-3xl border-2 border-b-0 border-penguin-peach bg-penguin-cream/55 px-4 py-3 sm:flex sm:px-5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-black text-penguin-gray">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  className="h-4 w-4 accent-penguin-pink-dark"
                />
                全選
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!sevenElevenEnabled}
                  onClick={handleShipClick}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-penguin-pink-dark px-4 py-2 text-xs font-black text-penguin-pink-dark shadow-sm transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PackageCheck size={14} />
                  7-11 出貨
                </button>
                <button
                  type="button"
                  disabled={!faceToFaceEnabled}
                  onClick={handleMeetupClick}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-gray-300 px-4 py-2 text-xs font-black text-penguin-gray shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  面交
                </button>
              </div>
            </div>

            {selectedNotArrived.length > 0 ? (
              <div className="hidden sm:block sm:my-3">
                <ShipBlockedNotice names={selectedNotArrived.map((group) => group.notebookName)} onDismiss={() => setSelected(new Set())} />
              </div>
            ) : null}
            {selectedGroups.length > 0 && selectedNotArrived.length === 0 && selectedHasUnpaid ? (
              <p className="my-3 hidden text-sm font-black text-red-600 sm:block">有商品未付款，無法申請出貨</p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <OrderCard
                  key={group.orderId}
                  group={group}
                  checked={selected.has(group.orderId)}
                  onToggle={(checked) => toggleGroup(group.orderId, checked)}
                  nickname={searchedNickname}
                  onPaymentSubmitted={() => runSearch(searchedNickname)}
                />
              ))}
            </div>
            </div>
          </section>
        )
      ) : null}

      {groups === null && !error && searchedNickname === "" && lineSession?.authenticated ? (
        <p className="mx-auto mt-10 max-w-xl text-center text-xs font-bold text-gray-400">
          完成社群暱稱綁定後，訂單會自動顯示在這裡。
        </p>
      ) : null}

      {/* Mobile fixed action bar */}
      {groups && groups.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-penguin-peach bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_20px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-black text-penguin-gray">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                className="h-4 w-4 accent-penguin-pink-dark"
              />
              全選
            </label>
            <p className="text-xs font-black text-penguin-gray">已選 {selectedGroups.length} 個記事本</p>
          </div>
          <div className="mt-2">
            <button
              type="button"
              disabled={!sevenElevenEnabled}
              onClick={handleShipClick}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-penguin-pink-dark px-4 py-2.5 text-xs font-black text-penguin-pink-dark shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PackageCheck size={14} />
              7-11 出貨
            </button>
            <button
              type="button"
              disabled={!faceToFaceEnabled}
              onClick={handleMeetupClick}
              className="mt-2 inline-flex w-full items-center justify-center rounded-full border-2 border-gray-300 px-4 py-2.5 text-xs font-black text-penguin-gray disabled:cursor-not-allowed disabled:opacity-50"
            >
              面交
            </button>
            {selectedGroups.length > 0 && selectedNotArrived.length === 0 && selectedHasUnpaid ? (
              <p className="mt-2 text-center text-xs font-black text-red-600">有商品未付款，無法申請出貨</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedNotArrived.length > 0 && groups && groups.length > 0 ? (
        <div className="fixed inset-x-4 bottom-28 z-40 sm:hidden">
          <ShipBlockedNotice names={selectedNotArrived.map((group) => group.notebookName)} onDismiss={() => setSelected(new Set())} />
        </div>
      ) : null}

      {shipmentOpen ? (
        <ShipmentRequestModal
          nickname={searchedNickname}
          groups={fulfillmentGroups}
          onClose={() => setShipmentOpen(false)}
          onSubmitted={() => runSearch(searchedNickname)}
        />
      ) : null}
      {meetupOpen ? (
        <MeetupRequestModal
          groups={fulfillmentGroups}
          onClose={() => setMeetupOpen(false)}
          onSubmitted={() => runSearch(searchedNickname)}
        />
      ) : null}
    </main>
  );
}

function ShipBlockedNotice({ names, onDismiss }: { names: string[]; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-xs font-bold text-red-600 shadow-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>以下商品尚未到貨或無法出貨：</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {names.map((name) => (
            <li key={name} className="truncate">{name}</li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={onDismiss} aria-label="關閉提示" className="shrink-0 text-red-400 hover:text-red-600">
        <X size={16} />
      </button>
    </div>
  );
}

function ShipmentRequestModal({
  nickname,
  groups,
  onClose,
  onSubmitted,
}: {
  nickname: string;
  groups: CommunityOrderGroup[];
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) {
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupStore, setPickupStore] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);

  const recipientValid = recipientName.trim().length > 0;
  const phoneValid = phone.trim().length >= 8;
  const storeValid = pickupStore.trim().length > 0;
  const formValid = recipientValid && phoneValid && storeValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid || submitting || submitted) return;
    setSubmitting(true);
    setSubmitted(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/community/shipment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          orderIds: groups.map((group) => group.orderId),
          recipientName: recipientName.trim(),
          phone: phone.trim(),
          pickupStore: pickupStore.trim(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "送出失敗，請稍後再試。");
      await onSubmitted();
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "送出失敗，請稍後再試。");
      setSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-penguin-gray/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-2 border-penguin-peach bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-penguin-gray">出貨申請</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="text-gray-400 hover:text-penguin-pink-dark">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <p className="text-sm font-bold text-penguin-gray">出貨申請已送出，小企鵝確認後會盡快為你安排！</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-full bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink"
            >
              關閉
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 space-y-2 rounded-2xl bg-penguin-cream/60 p-3">
              {groups.map((group) => (
                <div key={group.orderId} className="text-xs font-bold text-penguin-gray">
                  <p className="truncate">{group.notebookName}</p>
                  <ul className="mt-0.5 space-y-0.5 pl-3 text-[11px] font-medium text-gray-500">
                    {group.items.filter((item) => item.purchaseStatus === "bought").map((item) => (
                      <li key={item.itemId} className="truncate">
                        {item.productName}
                        {item.variantSpec ? `（${item.variantSpec}）` : ""} × {item.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-black text-penguin-gray">收件人姓名</label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(event) => setRecipientName(event.target.value)}
                  placeholder="請輸入收件人姓名"
                  className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold text-penguin-gray outline-none focus:border-penguin-pink-dark"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-black text-penguin-gray">手機號碼</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="請輸入手機號碼"
                  className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold tabular-nums text-penguin-gray outline-none focus:border-penguin-pink-dark"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-black text-penguin-gray">取貨門市</label>
                <input
                  type="text"
                  value={pickupStore}
                  onChange={(event) => setPickupStore(event.target.value)}
                  placeholder="例如：7-11 忠孝門市"
                  className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold text-penguin-gray outline-none focus:border-penguin-pink-dark"
                />
              </div>
              {submitError ? <p className="text-xs font-bold text-red-500">{submitError}</p> : null}
              <button
                type="submit"
                disabled={!formValid || submitting || submitted}
                className="w-full rounded-full bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "送出中..." : "送出出貨申請"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

type MeetupSlot = { id: string; date: string; startTime: string; endTime: string; location: string };

function MeetupRequestModal({ groups, onClose, onSubmitted }: {
  groups: CommunityOrderGroup[];
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) {
  const [slots, setSlots] = useState<MeetupSlot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"prepaid" | "pay_at_meetup">("prepaid");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/community/meetup-requests", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) throw new Error(result?.error || "面交時段讀取失敗。");
        if (active) {
          const next = Array.isArray(result.slots) ? result.slots : [];
          setSlots(next);
          setSlotId(next[0]?.id || "");
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "面交時段讀取失敗。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slotId || submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/community/meetup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: groups.map((group) => group.orderId), slotId, paymentMethod }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "面交預約送出失敗。");
      await onSubmitted();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "面交預約送出失敗。");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-penguin-gray/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-2 border-penguin-peach bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-penguin-gray">預約面交</h2>
          <button type="button" onClick={onClose} aria-label="關閉"><X size={20} /></button>
        </div>
        <div className="mb-4 rounded-2xl bg-penguin-cream/60 p-3 text-xs font-bold text-penguin-gray">
          {groups.map((group) => <p key={group.orderId}>{group.notebookName}</p>)}
        </div>
        {loading ? <p className="text-sm font-bold text-gray-500">讀取面交時段中...</p> : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-black text-penguin-gray">面交時段</label>
              <select value={slotId} onChange={(event) => setSlotId(event.target.value)} className="w-full rounded-xl border-2 border-penguin-peach p-3 text-sm font-bold text-penguin-gray">
                {slots.length ? slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.date} {slot.startTime}～{slot.endTime}｜{slot.location}</option>) : <option value="">目前沒有開放時段</option>}
              </select>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-black text-penguin-gray">付款方式</legend>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPaymentMethod("prepaid")} className={`rounded-xl border-2 p-3 text-sm font-black ${paymentMethod === "prepaid" ? "border-penguin-pink-dark bg-penguin-pink-light" : "border-gray-200"}`}>先匯款</button>
                <button type="button" onClick={() => setPaymentMethod("pay_at_meetup")} className={`rounded-xl border-2 p-3 text-sm font-black ${paymentMethod === "pay_at_meetup" ? "border-penguin-pink-dark bg-penguin-pink-light" : "border-gray-200"}`}>面交付款</button>
              </div>
            </fieldset>
            {paymentMethod === "prepaid" ? <p className="text-xs font-bold text-gray-500">請沿用記事本內的付款功能完成匯款。</p> : <p className="text-xs font-black text-penguin-pink-dark">本次選擇：面交付款</p>}
            {error ? <p className="text-xs font-bold text-red-500">{error}</p> : null}
            <button type="submit" disabled={!slotId || submitting} className="w-full rounded-full bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white disabled:opacity-50">{submitting ? "送出中..." : "送出面交預約"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
