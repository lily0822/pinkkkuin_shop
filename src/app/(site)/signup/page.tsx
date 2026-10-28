import { AuthForm } from "@/components/auth-form";
import { FeatureDisabledNotice } from "@/components/feature-disabled-notice";
import { getDisabledMessage, getSiteFeatureFlag, isEffectivelyEnabled } from "@/lib/site-feature-flags";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const flag = await getSiteFeatureFlag("signup");

  if (!isEffectivelyEnabled(flag)) {
    return (
      <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
        <FeatureDisabledNotice title="會員註冊暫未開放" message={getDisabledMessage(flag)} eyebrow="Pinkkkuin Member" />
      </main>
    );
  }

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <AuthForm mode="signup" />
    </main>
  );
}
