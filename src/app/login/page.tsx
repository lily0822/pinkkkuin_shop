import { AuthDisabledNotice } from "@/components/auth-disabled-notice";
import { AuthForm } from "@/components/auth-form";
import { getLineLoginMessage, getOAuthMessage } from "@/lib/auth/messages";
import { getSiteFeatureFlag } from "@/lib/site-feature-flags";
import { safeRelativePath } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; reset?: string; oauth?: string; line?: string }>;
}) {
  const flag = await getSiteFeatureFlag("login");

  if (!flag.enabled) {
    return (
      <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
        <AuthDisabledNotice title="會員登入暫未開放" message={flag.message} />
      </main>
    );
  }

  const params = await searchParams;
  const banner = getOAuthMessage(params?.oauth) || getLineLoginMessage(params?.line);

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      {params?.reset === "success" ? (
        <p className="mx-auto mb-4 max-w-md rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          密碼已更新，請使用新密碼登入。
        </p>
      ) : null}
      {banner ? (
        <p
          className={`mx-auto mb-4 max-w-md rounded-2xl px-4 py-3 text-sm font-bold ${
            banner.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
          }`}
        >
          {banner.text}
        </p>
      ) : null}
      <AuthForm mode="login" nextPath={safeRelativePath(params?.next, "/member/orders")} />
    </main>
  );
}
