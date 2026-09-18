"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Link2, Search, Wallet, PackageCheck, X } from "lucide-react";
import { formatPrice } from "@/lib/products";

type CommunityOrderRow = {
  orderId: string;
  notebookName: string;
  paymentStatus: string;
  arrivalStatus: string;
  orderStage: string;
  itemId: string;
  productName: string;
  variantSpec: string;
  quantity: number;
  unitPrice: number;
  itemSubtotal: number;
  snipeStatus: string;
  groupTotal: number;
  remitAmount: number;
  groupFirst: boolean;
};

type CommunityOrderGroup = {
  orderId: string;
  notebookName: string;
  paymentStatus: string;
  arrivalStatus: string;
  orderStage: string;
  groupTotal: number;
  remitAmount: number;
  items: CommunityOrderRow[];
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "待匯款",
  paid: "已匯款",
  in_person: "面交付",
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

const BANK_OPTIONS = ["國泰世華銀行", "台新銀行", "玉山銀行", "中國信託銀行", "郵局"];

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
        arrivalStatus: row.arrivalStatus,
        orderStage: row.orderStage,
        groupTotal: row.groupTotal,
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
  const paymentTone = group.paymentStatus === "paid" ? "green" : group.paymentStatus === "in_person" ? "blue" : "amber";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge label={`搶購 ${snipe.label}`} tone={snipe.tone} />
      <StatusBadge label={`匯款 ${PAYMENT_STATUS_LABEL[group.paymentStatus] || group.paymentStatus}`} tone={paymentTone} />
      <StatusBadge label={`到貨 ${ARRIVAL_STATUS_LABEL[group.arrivalStatus] || group.arrivalStatus}`} tone={arrivalTone} />
      <StatusBadge label={`下單 ${ORDER_STAGE_LABEL[group.orderStage] || group.orderStage}`} tone="purple" />
    </div>
  );
}

function OrderCard({
  group,
  checked,
  onToggle,
}: {
  group: CommunityOrderGroup;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <article className="rounded-2xl border-2 border-penguin-peach bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-penguin-pink-dark"
          aria-label={`選擇 ${group.notebookName}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-black text-penguin-gray">{group.notebookName}</p>
          <ul className="mt-2 divide-y divide-dashed divide-penguin-peach/70">
            {group.items.map((item) => (
              <li key={item.itemId} className="flex items-start justify-between gap-2 py-1.5 text-xs first:pt-0">
                <div className="min-w-0">
                  <p className="font-bold text-penguin-gray">{item.productName}</p>
                  {item.variantSpec ? <p className="text-[11px] text-gray-400">{item.variantSpec}</p> : null}
                </div>
                <p className="shrink-0 tabular-nums text-gray-500">
                  {item.quantity} × {formatPrice(item.unitPrice)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-0.5 border-t border-penguin-peach pt-2 text-sm">
            <div className="flex items-center justify-between font-black text-penguin-gray">
              <span>系列商品總金額</span>
              <span className="tabular-nums">{formatPrice(group.groupTotal)}</span>
            </div>
            <div className="flex items-center justify-between font-black text-penguin-pink-dark">
              <span>匯款金額</span>
              <span className="tabular-nums">{formatPrice(group.remitAmount)}</span>
            </div>
          </div>
          <div className="mt-3">
            <GroupStatusBadges group={group} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function CommunityOrdersClient() {
  const [nickname, setNickname] = useState("");
  const [searchedNickname, setSearchedNickname] = useState("");
  const [groups, setGroups] = useState<CommunityOrderGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shipBlocked, setShipBlocked] = useState<string[] | null>(null);
  const [remittanceOpen, setRemittanceOpen] = useState(false);
  const [shipmentOpen, setShipmentOpen] = useState(false);

  const allSelected = groups !== null && groups.length > 0 && groups.every((group) => selected.has(group.orderId));

  async function runSearch(value: string) {
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
      setShipBlocked(null);
      setSearchedNickname(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試。");
      setGroups(null);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch(nickname);
  }

  function toggleGroup(orderId: string, checked: boolean) {
    setShipBlocked(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (!groups) return;
    setShipBlocked(null);
    setSelected(checked ? new Set(groups.map((group) => group.orderId)) : new Set());
  }

  const selectedGroups = useMemo(() => {
    if (!groups) return [];
    return groups.filter((group) => selected.has(group.orderId));
  }, [groups, selected]);

  const selectedRemitTotal = useMemo(
    () => selectedGroups.reduce((sum, group) => sum + group.remitAmount, 0),
    [selectedGroups],
  );

  function handleShipClick() {
    const blocked = selectedGroups.filter((group) => group.arrivalStatus !== "arrived_taiwan");
    if (blocked.length > 0) {
      setShipBlocked(blocked.map((group) => group.notebookName));
      return;
    }
    setShipBlocked(null);
    setShipmentOpen(true);
  }

  function handleRemittanceClick() {
    setShipBlocked(null);
    setRemittanceOpen(true);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-8 sm:px-6 lg:px-8">
      <div className="mb-6 text-center">
        <p className="text-xs font-black text-penguin-pink-dark">社群下單查詢</p>
        <h1 className="mt-1 text-3xl font-black text-penguin-gray sm:text-4xl">社群訂單</h1>
        <p className="mt-2 text-sm font-bold text-gray-500">輸入你在社群下單時使用的暱稱，查詢下單明細與匯款金額。</p>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto flex max-w-xl flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="輸入你的社群暱稱！"
            className="h-12 w-full rounded-full border-2 border-penguin-peach bg-white pl-11 pr-4 text-sm font-bold text-penguin-gray shadow-sm outline-none focus:border-penguin-pink-dark"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !nickname.trim()}
          className="h-12 shrink-0 rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "查詢中..." : "查詢訂單"}
        </button>
      </form>

      <div className="mx-auto mt-3 max-w-xl text-center">
        <button
          type="button"
          disabled
          title="即將推出"
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-penguin-peach px-3 py-1.5 text-[11px] font-bold text-gray-400"
        >
          <Link2 size={12} />
          綁定 LINE 會員（即將推出）
        </button>
      </div>

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
            {/* Desktop toolbar */}
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
                  disabled={selectedGroups.length === 0}
                  onClick={handleRemittanceClick}
                  className="inline-flex items-center gap-1.5 rounded-full bg-penguin-pink-dark px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Wallet size={14} />
                  我要匯款
                </button>
                <button
                  type="button"
                  disabled={selectedGroups.length === 0}
                  onClick={handleShipClick}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-penguin-pink-dark px-4 py-2 text-xs font-black text-penguin-pink-dark shadow-sm transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PackageCheck size={14} />
                  我想出貨
                </button>
              </div>
            </div>

            {shipBlocked ? (
              <div className="hidden sm:block sm:my-3">
                <ShipBlockedNotice names={shipBlocked} onDismiss={() => setShipBlocked(null)} />
              </div>
            ) : null}

            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-b-3xl border-2 border-penguin-peach bg-white shadow-sm sm:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-penguin-peach bg-penguin-pink-light/40 text-penguin-gray">
                      <th className="w-10 px-3 py-2.5"></th>
                      <th className="px-3 py-2.5 font-black">記事本名稱</th>
                      <th className="px-3 py-2.5 font-black">下單商品</th>
                      <th className="px-3 py-2.5 text-right font-black">數量</th>
                      <th className="px-3 py-2.5 text-right font-black">單價</th>
                      <th className="px-3 py-2.5 text-right font-black">總金額</th>
                      <th className="px-3 py-2.5 text-right font-black">系列商品總金額</th>
                      <th className="px-3 py-2.5 text-right font-black">匯款金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) =>
                      group.items.map((item, index) => (
                        <tr
                          key={item.itemId}
                          className={`${index ? "border-t border-dashed border-penguin-peach/70" : "border-t border-penguin-peach"}`}
                        >
                          {index === 0 ? (
                            <td className="px-3 py-2.5 align-top" rowSpan={group.items.length}>
                              <input
                                type="checkbox"
                                checked={selected.has(group.orderId)}
                                onChange={(event) => toggleGroup(group.orderId, event.target.checked)}
                                className="h-5 w-5 accent-penguin-pink-dark"
                                aria-label={`選擇 ${group.notebookName}`}
                              />
                            </td>
                          ) : null}
                          {index === 0 ? (
                            <td className="px-3 py-2.5 align-top font-bold text-penguin-gray" rowSpan={group.items.length}>
                              {group.notebookName}
                            </td>
                          ) : null}
                          <td className="px-3 py-2.5 text-penguin-gray">{item.productName}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-penguin-gray">{item.quantity}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-penguin-gray">{formatPrice(item.unitPrice)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-penguin-gray">{formatPrice(item.itemSubtotal)}</td>
                          {index === 0 ? (
                            <td className="px-3 py-2.5 text-right align-top font-black tabular-nums text-penguin-gray" rowSpan={group.items.length}>
                              {formatPrice(group.groupTotal)}
                            </td>
                          ) : null}
                          {index === 0 ? (
                            <td className="px-3 py-2.5 text-right align-top font-black tabular-nums text-penguin-pink-dark" rowSpan={group.items.length}>
                              {formatPrice(group.remitAmount)}
                            </td>
                          ) : null}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {groups.map((group) => (
                <OrderCard
                  key={group.orderId}
                  group={group}
                  checked={selected.has(group.orderId)}
                  onToggle={(checked) => toggleGroup(group.orderId, checked)}
                />
              ))}
            </div>
          </section>
        )
      ) : null}

      {groups === null && !error && searchedNickname === "" ? (
        <p className="mx-auto mt-10 max-w-xl text-center text-xs font-bold text-gray-400">
          查詢結果只會顯示與你輸入暱稱相符的下單紀錄。
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
            <div className="min-w-0 text-right">
              <p className="text-[11px] font-bold text-gray-500">已選 {selectedGroups.length} 個系列</p>
              <p className="truncate text-sm font-black text-penguin-pink-dark">
                匯款總金額 {formatPrice(selectedRemitTotal)}
              </p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={selectedGroups.length === 0}
              onClick={handleRemittanceClick}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-penguin-pink-dark px-4 py-2.5 text-xs font-black text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wallet size={14} />
              我要匯款
            </button>
            <button
              type="button"
              disabled={selectedGroups.length === 0}
              onClick={handleShipClick}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-penguin-pink-dark px-4 py-2.5 text-xs font-black text-penguin-pink-dark shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PackageCheck size={14} />
              我想出貨
            </button>
          </div>
        </div>
      ) : null}

      {shipBlocked && groups && groups.length > 0 ? (
        <div className="fixed inset-x-4 bottom-28 z-40 sm:hidden">
          <ShipBlockedNotice names={shipBlocked} onDismiss={() => setShipBlocked(null)} />
        </div>
      ) : null}

      {remittanceOpen ? (
        <RemittanceModal
          nickname={searchedNickname}
          groups={selectedGroups}
          expectedTotal={selectedRemitTotal}
          onClose={() => setRemittanceOpen(false)}
        />
      ) : null}

      {shipmentOpen ? (
        <ShipmentRequestModal
          nickname={searchedNickname}
          groups={selectedGroups}
          onClose={() => setShipmentOpen(false)}
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

function RemittanceModal({
  nickname,
  groups,
  expectedTotal,
  onClose,
}: {
  nickname: string;
  groups: CommunityOrderGroup[];
  expectedTotal: number;
  onClose: () => void;
}) {
  const [bank, setBank] = useState(BANK_OPTIONS[0]);
  const [last5, setLast5] = useState("");
  const [amount, setAmount] = useState(String(expectedTotal));
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);

  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const last5Valid = /^[0-9]{5}$/.test(last5);
  const mismatch = amountValid && amountNumber !== expectedTotal;

  async function doSubmit() {
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/community/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          orderIds: groups.map((group) => group.orderId),
          bank,
          accountLast5: last5,
          amount: amountNumber,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "送出失敗，請稍後再試。");
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "送出失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!last5Valid || !amountValid) return;
    if (mismatch && !confirmMismatch) {
      setConfirmMismatch(true);
      return;
    }
    doSubmit();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-penguin-gray/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-2 border-penguin-peach bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-penguin-gray">匯款資訊</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="text-gray-400 hover:text-penguin-pink-dark">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <p className="text-sm font-bold text-penguin-gray">匯款資訊已送出，小企鵝確認後會盡快處理！</p>
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
            <div className="mb-4 space-y-1.5 rounded-2xl bg-penguin-cream/60 p-3">
              {groups.map((group) => (
                <div key={group.orderId} className="flex items-center justify-between text-xs font-bold text-penguin-gray">
                  <span className="truncate pr-2">{group.notebookName}</span>
                  <span className="shrink-0 tabular-nums">{formatPrice(group.remitAmount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-penguin-peach pt-1.5 text-sm font-black text-penguin-pink-dark">
                <span>系統應匯總金額</span>
                <span className="tabular-nums">{formatPrice(expectedTotal)}</span>
              </div>
            </div>

            {!confirmMismatch ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-black text-penguin-gray">老闆娘的哪家銀行</label>
                  <select
                    value={bank}
                    onChange={(event) => setBank(event.target.value)}
                    className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold text-penguin-gray outline-none focus:border-penguin-pink-dark"
                  >
                    {BANK_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-penguin-gray">你的後五碼</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={last5}
                    onChange={(event) => setLast5(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    placeholder="請輸入帳號後五碼"
                    className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold tabular-nums text-penguin-gray outline-none focus:border-penguin-pink-dark"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black text-penguin-gray">匯款金額</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-11 w-full rounded-xl border-2 border-penguin-peach bg-white px-3 text-sm font-bold tabular-nums text-penguin-gray outline-none focus:border-penguin-pink-dark"
                  />
                </div>
                {submitError ? <p className="text-xs font-bold text-red-500">{submitError}</p> : null}
                <button
                  type="submit"
                  disabled={!last5Valid || !amountValid || submitting}
                  className="w-full rounded-full bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "送出中..." : "送出匯款資訊"}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <p>
                    你填寫的金額 {formatPrice(amountNumber)} 與系統應匯金額 {formatPrice(expectedTotal)} 不同，確定要送出嗎？
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmMismatch(false)}
                    className="rounded-full border-2 border-penguin-peach px-4 py-3 text-sm font-black text-penguin-gray transition hover:bg-penguin-pink-light"
                  >
                    返回修改
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={doSubmit}
                    className="rounded-full bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "送出中..." : "確定送出"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ShipmentRequestModal({
  nickname,
  groups,
  onClose,
}: {
  nickname: string;
  groups: CommunityOrderGroup[];
  onClose: () => void;
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
                    {group.items.map((item) => (
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
