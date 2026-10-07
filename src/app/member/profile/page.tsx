import { redirect } from "next/navigation";
import { MemberProfileManager } from "@/components/member-profile-manager";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MemberProfilePage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent("/member/profile")}`);
  }

  const [{ data: profile }, { data: addresses }] = await Promise.all([
    supabase.from("member_profiles").select("display_name,phone,status").eq("user_id", data.user.id).maybeSingle(),
    supabase
      .from("member_addresses")
      .select("id,recipient_name,phone,postal_code,city,district,address_line,is_default,created_at")
      .eq("user_id", data.user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  return (
    <MemberProfileManager
      email={data.user.email || ""}
      emailVerified={Boolean(data.user.email_confirmed_at)}
      initialProfile={profile ? { displayName: profile.display_name || "", phone: profile.phone || "", status: profile.status || "active" } : null}
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
  );
}
