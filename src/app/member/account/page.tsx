import { redirect } from "next/navigation";
import { MemberSecurityPanel } from "@/components/member-security-panel";
import { getGoogleBindingMessage, getLineBindingMessage } from "@/lib/member/messages";
import { getCachedAuthUser } from "@/lib/supabase/server";

export default async function MemberAccountPage({
  searchParams,
}: {
  searchParams?: Promise<{ line?: string; google?: string }>;
}) {
  const params = await searchParams;
  const { supabase, data, error } = await getCachedAuthUser();
  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent("/member/account")}`);
  }

  const identities = data.user.identities || [];
  const hasEmailIdentity = identities.some((identity) => identity.provider === "email");
  const googleIdentity = identities.find((identity) => identity.provider === "google");
  const googleEmail =
    googleIdentity && typeof googleIdentity.identity_data?.email === "string" ? googleIdentity.identity_data.email : null;

  const { data: lineBinding } = await supabase
    .from("member_line_accounts")
    .select("linked_at")
    .eq("user_id", data.user.id)
    .maybeSingle();

  return (
    <MemberSecurityPanel
      hasEmailIdentity={hasEmailIdentity}
      googleEmail={googleEmail}
      initialLineLinkedAt={lineBinding?.linked_at || null}
      lineBanner={getLineBindingMessage(params?.line)}
      googleBanner={getGoogleBindingMessage(params?.google)}
    />
  );
}
