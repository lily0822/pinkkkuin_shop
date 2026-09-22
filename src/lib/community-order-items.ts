import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type CommunityOrderBaseRow = {
  orderId: string;
  itemId: string;
  itemSubtotal: number;
};

type CommunityItemStatusRow = {
  id: string;
  purchase_status: string;
  arrival_status: string;
};

export async function enrichCommunityOrderRows<T extends CommunityOrderBaseRow>(
  supabase: SupabaseClient,
  rows: T[],
) {
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter(Boolean))];
  const statusByItemId = new Map<string, CommunityItemStatusRow>();

  if (itemIds.length > 0) {
    const { data, error } = await supabase
      .from("community_order_items")
      .select("id,purchase_status,arrival_status")
      .in("id", itemIds);
    if (error) throw error;
    for (const row of (data || []) as CommunityItemStatusRow[]) statusByItemId.set(row.id, row);
  }

  const boughtTotalByOrderId = new Map<string, number>();
  for (const row of rows) {
    const status = statusByItemId.get(row.itemId);
    const purchaseStatus = status?.purchase_status || "bought";
    if (purchaseStatus === "bought") {
      boughtTotalByOrderId.set(row.orderId, (boughtTotalByOrderId.get(row.orderId) || 0) + row.itemSubtotal);
    }
  }

  return rows.map((row) => {
    const status = statusByItemId.get(row.itemId);
    return {
      ...row,
      purchaseStatus: status?.purchase_status || "bought",
      itemArrivalStatus: status?.arrival_status || "not_arrived",
      boughtTotal: boughtTotalByOrderId.get(row.orderId) || 0,
    };
  });
}
