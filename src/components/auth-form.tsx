"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { PasswordInput } from "@/components/password-input";

type AuthMode = "signup" | "login" | "forgot" | "reset";

type AuthFormProps = {
  mode: AuthMode;
  nextPath?: string;
};

const modeText: Record<AuthMode, { title: string; submit: string; success?: string }> = {
  signup: { title: "會員註冊", submit: "建立帳號" },
  login: { title: "會員登入", submit: "登入" },
  forgot: { title: "忘記密碼", submit: "寄出重設信" },
  reset: { title: "重設密碼", submit: "更新密碼" },
};

function authEndpoint(mode: AuthMode) {
  if (mode === "signup") return "/api/auth/signup";
  if (mode === "login") return "/api/auth/login";
  if (mode === "forgot") return "/api/auth/forgot-password";
  return "/api/auth/reset-password";
}

function GoogleButton({ nextPath }: { nextPath: string }) {
  return (
    <form action="/api/auth/google/start" method="get">
      <input type="hidden" name="next" value={nextPath} />
      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border-2 border-penguin-peach bg-white px-6 text-sm font-black text-penguin-gray shadow-sm transition hover:-translate-y-0.5"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24Z" />
          <path fill="#FBBC05" d="M5.4 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.4A12 12 0 0 0 0 12c0 1.9.5 3.8 1.4 5.4Z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
        </svg>
        使用 Google 繼續
      </button>
    </form>
  );
}

function LineButton({ nextPath }: { nextPath: string }) {
  return (
    <form action="/api/auth/line/start" method="get">
      <input type="hidden" name="next" value={nextPath} />
      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[#06C755] px-6 text-sm font-black text-white shadow-md transition hover:-translate-y-0.5"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.5 2 2 5.8 2 10.5c0 4.1 3.5 7.6 8.3 8.3-.3 1.2-1.2 3.1-1.3 3.6-.2.6.2.6.5.4.2-.1 3.3-2.2 4.7-3.1.6.1 1.2.1 1.8.1 5.5 0 10-3.8 10-8.5S17.5 2 12 2Z" />
        </svg>
        使用 LINE 登入
      </button>
    </form>
  );
}

export function AuthForm({ mode, nextPath = "/member" }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const text = modeText[mode];
  const needsEmail = mode !== "reset";
  const needsPassword = mode === "signup" || mode === "login" || mode === "reset";
  const needsConfirm = mode === "signup" || mode === "reset";
  const showOAuthButtons = mode === "login" || mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(authEndpoint(mode), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          confirmPassword,
          next: nextPath,
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string; next?: string } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "操作失敗，請稍後再試。");
      }

      if (mode === "login") {
        router.replace(result.next || nextPath);
        router.refresh();
        return;
      }
      if (mode === "reset") {
        router.replace("/login?reset=success");
        router.refresh();
        return;
      }
      setMessage(result.message || "處理完成，請依信件指示繼續。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-md rounded-[28px] border-2 border-penguin-peach bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Pinkkkuin Member</p>
      <h1 className="mt-2 text-3xl font-black text-penguin-gray">{text.title}</h1>

      <div className="mt-7 space-y-4">
        {needsEmail ? (
          <label className="block text-sm font-black text-penguin-gray">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 text-sm font-bold outline-none transition focus:border-penguin-pink"
              required
            />
          </label>
        ) : null}

        {needsPassword ? (
          <PasswordInput
            label="密碼"
            value={password}
            onChange={setPassword}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        ) : null}

        {needsConfirm ? (
          <PasswordInput label="確認密碼" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        ) : null}
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}
      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 h-12 w-full rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "處理中..." : text.submit}
      </button>

      {showOAuthButtons ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 text-xs font-bold text-gray-400">
            <span className="h-px flex-1 bg-penguin-peach" />
            <span>或</span>
            <span className="h-px flex-1 bg-penguin-peach" />
          </div>
          <GoogleButton nextPath={nextPath} />
          {mode === "login" ? (
            <>
              <LineButton nextPath={nextPath} />
              <p className="text-center text-xs font-bold text-gray-400">僅限已在會員中心綁定 LINE 的帳號可用此方式登入。</p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-bold text-penguin-pink-dark">
        {mode !== "login" ? <Link href="/login">會員登入</Link> : null}
        {mode !== "signup" ? <Link href="/signup">會員註冊</Link> : null}
        {mode !== "forgot" && mode !== "reset" ? <Link href="/forgot-password">忘記密碼</Link> : null}
      </div>
    </form>
  );
}
