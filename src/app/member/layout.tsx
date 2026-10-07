import { redirect } from "next/navigation";
import { MemberSidebar } from "@/components/member-sidebar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent("/member/orders")}`);
  }

  const { data: profile } = await supabase
    .from("member_profiles")
    .select("display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const displayName = profile?.display_name || data.user.email || "會員";

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Member</p>
        <h1 className="mt-2 text-3xl font-black text-penguin-gray">會員中心</h1>

        <div className="mt-6 grid gap-5 md:grid-cols-[236px_1fr] md:items-start">
          <MemberSidebar displayName={displayName} />
          <div>{children}</div>
        </div>
      </section>
    </main>
  );
}
