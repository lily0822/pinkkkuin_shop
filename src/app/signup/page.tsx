import { AuthForm } from "@/components/auth-form";
import { isMemberSignupEnabled } from "@/lib/member/signup";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (!isMemberSignupEnabled()) {
    return (
      <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto w-full max-w-md rounded-[28px] border-2 border-penguin-peach bg-white p-6 text-center shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Pinkkkuin Member</p>
          <h1 className="mt-2 text-3xl font-black text-penguin-gray">會員註冊暫未開放</h1>
          <p className="mt-4 text-sm font-bold leading-7 text-gray-500">
            會員功能正在準備中，目前仍可用訪客身分瀏覽商品與結帳。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <AuthForm mode="signup" />
    </main>
  );
}
