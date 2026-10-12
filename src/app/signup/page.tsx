import { AuthDisabledNotice } from "@/components/auth-disabled-notice";
import { AuthForm } from "@/components/auth-form";
import { getSiteFeatureFlag } from "@/lib/site-feature-flags";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const flag = await getSiteFeatureFlag("signup");

  if (!flag.enabled) {
    return (
      <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
        <AuthDisabledNotice title="會員註冊暫未開放" message={flag.message} />
      </main>
    );
  }

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <AuthForm mode="signup" />
    </main>
  );
}
