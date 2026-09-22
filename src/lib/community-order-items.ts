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
  refunded_at: string | null;
};

type CommunityPaymentRefundRow = {
  submission_id: string;
  amount: number | string;
  completed_at: string;
};

type CommunityShipmentRequestRow = {
  id: string;
  order_ids: string[];
  shipping_method: string;
  status: string;
  marketplace_url: string | null;
  marketplace_order_ref: string | null;
  submitted_at: string;
};

type CommunityMeetupRequestRow = {
  id: string;
  order_ids: string[];
  payment_method: string;
  status: string;
  submitted_at: string;
  community_meetup_slots: {
    meetup_date: string;
    start_time: string;
    end_time: string;
    location: string;
  } | null;
};

const ACCEPTED_PAYMENT_STATUSES = new Set([
  "approved",
  "topup_required",
  "overpaid_pending_refund",
  "refund_completed",
]);

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

export async function enrichCommunityPaymentRows<T extends { orderId: string; boughtTotal?: number }>(
  supabase: SupabaseClient,
  rows: T[],
) {
  const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))];
  const submissionsByOrderId = new Map<string, CommunityPaymentSubmissionRow[]>();
  const refundsBySubmissionId = new Map<string, CommunityPaymentRefundRow>();

  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("community_remittance_submissions")
      .select("id,order_ids,bank,account_last5,amount,expected_amount,status,rejection_reason,submitted_at,reviewed_at,refunded_at")
      .overlaps("order_ids", orderIds)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    const submissions = (data || []) as CommunityPaymentSubmissionRow[];
    for (const submission of submissions) {
      for (const orderId of submission.order_ids || []) {
        if (!orderIds.includes(orderId)) continue;
        const list = submissionsByOrderId.get(orderId) || [];
        list.push(submission);
        submissionsByOrderId.set(orderId, list);
      }
    }
    const submissionIds = submissions.map((submission) => submission.id);
    if (submissionIds.length > 0) {
      const { data: refundData, error: refundError } = await supabase
        .from("community_payment_refunds")
        .select("submission_id,amount,completed_at")
        .in("submission_id", submissionIds);
      if (refundError) throw refundError;
      for (const refund of (refundData || []) as CommunityPaymentRefundRow[]) {
        refundsBySubmissionId.set(refund.submission_id, refund);
      }
    }
  }

  return rows.map((row) => {
    const submissions = submissionsByOrderId.get(row.orderId) || [];
    const submission = submissions[0];
    const expectedAmount = Number(row.boughtTotal ?? submission?.expected_amount ?? 0);
    const cumulativeReceived = submissions.reduce(
      (total, payment) => total + (ACCEPTED_PAYMENT_STATUSES.has(payment.status) ? Number(payment.amount || 0) : 0),
      0,
    );
    const remainingAmount = Math.max(expectedAmount - cumulativeReceived, 0);
    const overpaidAmount = Math.max(cumulativeReceived - expectedAmount, 0);
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
      paymentRefundedAt: submission?.refunded_at || "",
      paymentCumulativeReceived: cumulativeReceived,
      paymentRemainingAmount: remainingAmount,
      paymentOverpaidAmount: overpaidAmount,
      paymentHistory: submissions.map((payment) => {
        const refund = refundsBySubmissionId.get(payment.id);
        return {
          id: payment.id,
          bank: payment.bank,
          accountLast5: payment.account_last5,
          amount: Number(payment.amount || 0),
          expectedAmount: Number(payment.expected_amount || 0),
          status: payment.status,
          rejectionReason: payment.rejection_reason || "",
          submittedAt: payment.submitted_at,
          reviewedAt: payment.reviewed_at || "",
          refundedAt: payment.refunded_at || "",
          refundAmount: Number(refund?.amount || 0),
          refundCompletedAt: refund?.completed_at || "",
        };
      }),
    };
  });
}

export async function enrichCommunityShipmentRows<T extends {
  orderId: string;
  paymentStatus?: string;
  purchaseStatus?: string;
  itemArrivalStatus?: string;
}>(supabase: SupabaseClient, rows: T[]) {
  const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))];
  const activeByOrderId = new Map<string, CommunityShipmentRequestRow>();
  const meetupByOrderId = new Map<string, CommunityMeetupRequestRow>();

  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("community_shipment_requests")
      .select("id,order_ids,shipping_method,status,marketplace_url,marketplace_order_ref,submitted_at")
      .overlaps("order_ids", orderIds)
      .neq("status", "cancelled")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    for (const request of (data || []) as CommunityShipmentRequestRow[]) {
      for (const orderId of request.order_ids || []) {
        if (orderIds.includes(orderId) && !activeByOrderId.has(orderId)) activeByOrderId.set(orderId, request);
      }
    }

    const { data: meetupData, error: meetupError } = await supabase
      .from("community_meetup_requests")
      .select("id,order_ids,payment_method,status,submitted_at,community_meetup_slots(meetup_date,start_time,end_time,location)")
      .overlaps("order_ids", orderIds)
      .neq("status", "cancelled")
      .order("submitted_at", { ascending: false });
    if (meetupError) throw meetupError;
    for (const request of (meetupData || []) as unknown as CommunityMeetupRequestRow[]) {
      for (const orderId of request.order_ids || []) {
        if (orderIds.includes(orderId) && !meetupByOrderId.has(orderId)) meetupByOrderId.set(orderId, request);
      }
    }
  }

  const boughtStateByOrderId = new Map<string, { count: number; allArrived: boolean }>();
  for (const row of rows) {
    if (row.purchaseStatus !== "bought") continue;
    const current = boughtStateByOrderId.get(row.orderId) || { count: 0, allArrived: true };
    current.count += 1;
    current.allArrived = current.allArrived && row.itemArrivalStatus === "arrived";
    boughtStateByOrderId.set(row.orderId, current);
  }

  return rows.map((row) => {
    const request = activeByOrderId.get(row.orderId);
    const meetup = meetupByOrderId.get(row.orderId);
    const bought = boughtStateByOrderId.get(row.orderId) || { count: 0, allArrived: false };
    const paid = row.paymentStatus === "paid";
    return {
      ...row,
      shipmentLocked: Boolean(request || meetup),
      shipmentEligible: !request && !meetup && bought.count > 0 && bought.allArrived && paid,
      meetupEligible: !request && !meetup && bought.count > 0 && bought.allArrived,
      shipmentAllBoughtArrived: bought.count > 0 && bought.allArrived,
      shipmentPaid: paid,
      shipmentRequestId: request?.id || meetup?.id || "",
      shipmentRequestStatus: request?.status || meetup?.status || "",
      shipmentMethod: request?.shipping_method || (meetup ? "face_to_face" : ""),
      shipmentMarketplaceUrl: request?.marketplace_url || "",
      shipmentMarketplaceOrderRef: request?.marketplace_order_ref || "",
      shipmentSubmittedAt: request?.submitted_at || "",
      meetupPaymentMethod: meetup?.payment_method || "",
      meetupDate: meetup?.community_meetup_slots?.meetup_date || "",
      meetupStartTime: meetup?.community_meetup_slots?.start_time || "",
      meetupEndTime: meetup?.community_meetup_slots?.end_time || "",
      meetupLocation: meetup?.community_meetup_slots?.location || "",
    };
  });
}
