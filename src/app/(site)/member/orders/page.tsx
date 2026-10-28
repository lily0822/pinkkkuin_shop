import { redirect } from "next/navigation";
import { MemberOrdersTabs } from "@/components/member-orders-tabs";
import type { MemberOrder } from "@/components/member-order-list";
import { getCachedAuthUser } from "@/lib/supabase/server";

function mapMemberOrder(row: Record<string, unknown>): MemberOrder {
  return {
    id: String(row.id || ""),
    orderNo: String(row.order_no || ""),
    productType: String(row.order_type || ""),
    createdAt: String(row.created_at || ""),
    total: Number(row.total || 0),
    status: String(row.status || ""),
    paymentStatus: String(row.payment_status || ""),
    shippingStatus: String(row.shipping_status || ""),
  };
}

export default async function MemberOrdersPage() {
  const { supabase, data, error } = await getCachedAuthUser();
  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent("/member/orders")}`);
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("id,order_no,order_type,created_at,total,status,payment_status,shipping_status")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return <MemberOrdersTabs initialOrders={(orders || []).map(mapMemberOrder)} />;
}
