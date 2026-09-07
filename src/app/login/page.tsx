import { AuthForm } from "@/components/auth-form";
import { safeRelativePath } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; reset?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      {params?.reset === "success" ? (
        <p className="mx-auto mb-4 max-w-md rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          密碼已更新，請使用新密碼登入。
        </p>
      ) : null}
      <AuthForm mode="login" nextPath={safeRelativePath(params?.next, "/member")} />
    </main>
  );
}
