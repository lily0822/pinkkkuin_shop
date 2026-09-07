import { AuthForm } from "@/components/auth-form";

export default function ForgotPasswordPage() {
  return (
    <main className="bg-penguin-cream px-4 py-12 sm:px-6 lg:px-8">
      <AuthForm mode="forgot" />
    </main>
  );
}
