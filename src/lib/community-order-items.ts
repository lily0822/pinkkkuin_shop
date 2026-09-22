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

type CommunityPaymentSubmissionRow = {
  id: string;
  order_ids: string[];
  bank: string;
  account_last5: string;
  amount: number | string;
  expected_amount: number | string;
  status: string;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
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

export async function enrichCommunityPaymentRows<T extends { orderId: string }>(
  supabase: SupabaseClient,
  rows: T[],
) {
  const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))];
  const latestByOrderId = new Map<string, CommunityPaymentSubmissionRow>();

  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("community_remittance_submissions")
      .select("id,order_ids,bank,account_last5,amount,expected_amount,status,rejection_reason,submitted_at,reviewed_at")
      .overlaps("order_ids", orderIds)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    for (const submission of (data || []) as CommunityPaymentSubmissionRow[]) {
      for (const orderId of submission.order_ids || []) {
        if (orderIds.includes(orderId) && !latestByOrderId.has(orderId)) latestByOrderId.set(orderId, submission);
      }
    }
  }

  return rows.map((row) => {
    const submission = latestByOrderId.get(row.orderId);
    return {
      ...row,
      paymentSubmissionId: submission?.id || "",
      paymentReviewStatus: submission?.status || "unpaid",
      paymentRejectionReason: submission?.rejection_reason || "",
      paymentBank: submission?.bank || "",
      paymentAccountLast5: submission?.account_last5 || "",
      paymentSubmittedAmount: Number(submission?.amount || 0),
      paymentExpectedAmount: Number(submission?.expected_amount || 0),
      paymentSubmittedAt: submission?.submitted_at || "",
      paymentReviewedAt: submission?.reviewed_at || "",
    };
  });
}
