import { redirect } from "next/navigation";
import { MemberLineBinding } from "@/components/member-line-binding";
import { MemberLogoutButton } from "@/components/member-logout-button";
import { MemberOrderList, type MemberOrder } from "@/components/member-order-list";
import { MemberProfileManager } from "@/components/member-profile-manager";
import { createSupabaseServerClient, safeRelativePath } from "@/lib/supabase/server";

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

export default async function MemberPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent(safeRelativePath("/member"))}`);
  }

  const [{ data: profile }, { data: addresses }, { data: orders }, { data: lineBinding }] = await Promise.all([
    supabase
      .from("member_profiles")
      .select("display_name,phone,status")
      .eq("user_id", data.user.id)
      .maybeSingle(),
    supabase
      .from("member_addresses")
      .select("id,recipient_name,phone,postal_code,city,district,address_line,is_default,created_at")
      .eq("user_id", data.user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id,order_no,order_type,created_at,total,status,payment_status,shipping_status")
      .eq("user_id", data.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("member_line_accounts")
      .select("linked_at")
      .eq("user_id", data.user.id)
      .maybeSingle(),
  ]);

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Member</p>
            <h1 className="mt-2 text-3xl font-black text-penguin-gray">會員中心</h1>
            <p className="mt-2 text-sm font-bold text-gray-500">管理基本資料與常用收件地址。</p>
          </div>
          <MemberLogoutButton />
        </div>

        <MemberProfileManager
          email={data.user.email || ""}
          emailVerified={Boolean(data.user.email_confirmed_at)}
          initialProfile={profile ? {
            displayName: profile.display_name || "",
            phone: profile.phone || "",
            status: profile.status || "active",
          } : null}
          initialAddresses={(addresses || []).map((address) => ({
            id: address.id,
            recipientName: address.recipient_name || "",
            phone: address.phone || "",
            postalCode: address.postal_code || "",
            city: address.city || "",
            district: address.district || "",
            addressLine: address.address_line || "",
            isDefault: Boolean(address.is_default),
          }))}
        />

        <div className="mt-8">
          <MemberOrderList initialOrders={(orders || []).map((order) => mapMemberOrder(order))} />
        </div>

        <div className="mt-8">
          <MemberLineBinding initialLinkedAt={lineBinding?.linked_at || null} />
        </div>
      </section>
    </main>
  );
}
