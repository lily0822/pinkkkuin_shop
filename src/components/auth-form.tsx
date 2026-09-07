"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

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
          <label className="block text-sm font-black text-penguin-gray">
            密碼
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 text-sm font-bold outline-none transition focus:border-penguin-pink"
              required
            />
          </label>
        ) : null}

        {needsConfirm ? (
          <label className="block text-sm font-black text-penguin-gray">
            確認密碼
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 text-sm font-bold outline-none transition focus:border-penguin-pink"
              required
            />
          </label>
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

      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-bold text-penguin-pink-dark">
        {mode !== "login" ? <Link href="/login">已有帳號，前往登入</Link> : null}
        {mode !== "signup" ? <Link href="/signup">建立會員帳號</Link> : null}
        {mode !== "forgot" && mode !== "reset" ? <Link href="/forgot-password">忘記密碼</Link> : null}
      </div>
    </form>
  );
}
