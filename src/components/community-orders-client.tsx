"use client";

import { FormEvent, useMemo, useState } from "react";
import { Link2, Search, Wallet, PackageCheck } from "lucide-react";
import { formatPrice } from "@/lib/products";
import { contactLinks } from "@/lib/site";

type CommunityOrderRow = {
  orderId: string;
  notebookName: string;
  itemId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  itemSubtotal: number;
  groupTotal: number;
  remitAmount: number;
  groupFirst: boolean;
};

type CommunityOrderGroup = {
  orderId: string;
  notebookName: string;
  groupTotal: number;
  remitAmount: number;
  items: CommunityOrderRow[];
};

function groupRows(rows: CommunityOrderRow[]): CommunityOrderGroup[] {
  const groups: CommunityOrderGroup[] = [];
  const byId = new Map<string, CommunityOrderGroup>();
  for (const row of rows) {
    let group = byId.get(row.orderId);
    if (!group) {
      group = {
        orderId: row.orderId,
        notebookName: row.notebookName,
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

export function CommunityOrdersClient() {
  const [nickname, setNickname] = useState("");
  const [searchedNickname, setSearchedNickname] = useState("");
  const [groups, setGroups] = useState<CommunityOrderGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (!groups) return;
    setSelected(checked ? new Set(groups.map((group) => group.orderId)) : new Set());
  }

  const selectedNotebookNames = useMemo(() => {
    if (!groups) return [];
    return groups.filter((group) => selected.has(group.orderId)).map((group) => group.notebookName);
  }, [groups, selected]);

  function openLineContact() {
    window.open(contactLinks.line, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
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
          <section className="mt-8 overflow-hidden rounded-3xl border-2 border-penguin-peach bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-penguin-peach bg-penguin-cream/55 px-4 py-3 sm:px-5">
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
                  disabled={selectedNotebookNames.length === 0}
                  onClick={openLineContact}
                  className="inline-flex items-center gap-1.5 rounded-full bg-penguin-pink-dark px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Wallet size={14} />
                  我要匯款
                </button>
                <button
                  type="button"
                  disabled={selectedNotebookNames.length === 0}
                  onClick={openLineContact}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-penguin-pink-dark px-4 py-2 text-xs font-black text-penguin-pink-dark shadow-sm transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PackageCheck size={14} />
                  我想出貨
                </button>
              </div>
            </div>

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
          </section>
        )
      ) : null}

      {groups === null && !error && searchedNickname === "" ? (
        <p className="mx-auto mt-10 max-w-xl text-center text-xs font-bold text-gray-400">
          查詢結果只會顯示與你輸入暱稱相符的下單紀錄。
        </p>
      ) : null}
    </main>
  );
}
