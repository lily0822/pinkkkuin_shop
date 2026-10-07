"use client";

import { FormEvent, useState } from "react";
import { KeyRound, Link2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";

type BannerMessage = { kind: "success" | "error"; text: string } | null;

type MemberSecurityPanelProps = {
  hasEmailIdentity: boolean;
  googleEmail: string | null;
  initialLineLinkedAt: string | null;
  lineBanner: BannerMessage;
  googleBanner: BannerMessage;
};

function dateText(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function Banner({ banner }: { banner: BannerMessage }) {
  if (!banner) return null;
  return (
    <p className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${banner.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
      {banner.text}
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.4A12 12 0 0 0 0 12c0 1.9.5 3.8 1.4 5.4Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true" className="block">
      <rect width="24" height="24" rx="6" fill="#06C755" />
      <rect x="5" y="6" width="14" height="10" rx="3" fill="#fff" />
      <path d="M8 15.5 7 19 11.5 15.5Z" fill="#fff" />
    </svg>
  );
}

function MethodRow({
  icon,
  name,
  statusText,
  statusOn,
  action,
  iconFillsContainer = false,
}: {
  icon: React.ReactNode;
  name: string;
  statusText: string;
  statusOn: boolean;
  action: React.ReactNode;
  iconFillsContainer?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-penguin-peach bg-penguin-cream px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div
          className={
            iconFillsContainer
              ? "h-10 w-10 flex-shrink-0 overflow-hidden rounded-[10px]"
              : "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] border-2 border-penguin-peach bg-white"
          }
        >
          {icon}
        </div>
        <div>
          <p className="font-black text-penguin-gray">{name}</p>
          <p className={`mt-0.5 text-xs font-bold ${statusOn ? "text-emerald-600" : "text-gray-400"}`}>{statusText}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

export function MemberSecurityPanel({
  hasEmailIdentity,
  googleEmail,
  initialLineLinkedAt,
  lineBanner,
  googleBanner,
}: MemberSecurityPanelProps) {
  const [lineLinkedAt, setLineLinkedAt] = useState(initialLineLinkedAt);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [lineBusy, setLineBusy] = useState(false);
  const [lineError, setLineError] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState("");

  const isLineLinked = Boolean(lineLinkedAt);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;
    setSavingPassword(true);
    setPasswordMessage("");
    setPasswordError("");
    try {
      const response = await fetch("/api/member/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword, confirmPassword }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "密碼更新失敗。");
      setPasswordMessage(result.message || "密碼已更新。");
      setNewPassword("");
      setConfirmPassword("");
    } catch (saveError) {
      setPasswordError(saveError instanceof Error ? saveError.message : "密碼更新失敗。");
    } finally {
      setSavingPassword(false);
    }
  }

  async function unbindLine() {
    if (lineBusy || !isLineLinked) return;
    setLineBusy(true);
    setLineError("");
    try {
      const response = await fetch("/api/member/line", { method: "DELETE" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "LINE 解除綁定失敗。");
      setLineLinkedAt(null);
    } catch (unbindError) {
      setLineError(unbindError instanceof Error ? unbindError.message : "LINE 解除綁定失敗。");
    } finally {
      setLineBusy(false);
    }
  }

  async function unbindGoogle() {
    if (googleBusy || !googleEmail) return;
    setGoogleBusy(true);
    setGoogleError("");
    try {
      const response = await fetch("/api/member/google", { method: "DELETE" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Google 解除綁定失敗。");
      window.location.reload();
    } catch (unbindError) {
      setGoogleError(unbindError instanceof Error ? unbindError.message : "Google 解除綁定失敗。");
      setGoogleBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <KeyRound size={20} className="text-penguin-pink-dark" />
          <h2 className="text-xl font-black text-penguin-gray">{hasEmailIdentity ? "修改密碼" : "設定密碼"}</h2>
        </div>
        <p className="mt-1 text-sm font-bold text-gray-500">
          {hasEmailIdentity ? "定期更換密碼可以提升帳號安全性。" : "設定密碼後，也可以用 email + 密碼登入這個會員。"}
        </p>

        {passwordMessage ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{passwordMessage}</p> : null}
        {passwordError ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{passwordError}</p> : null}

        <form onSubmit={savePassword} className="mt-5 grid gap-4 sm:grid-cols-2">
          <PasswordInput label="新密碼" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordInput label="確認新密碼" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-full bg-penguin-pink-dark px-6 py-3 text-sm font-black text-white shadow-md disabled:opacity-60"
            >
              {savingPassword ? "更新中..." : "更新密碼"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-penguin-gray">登入方式</h2>
        <p className="mt-1 text-sm font-bold text-gray-500">管理可以用來登入這個會員帳號的方式。</p>

        <Banner banner={googleBanner} />
        <Banner banner={lineBanner} />
        {googleError ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{googleError}</p> : null}
        {lineError ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{lineError}</p> : null}

        <div className="grid gap-3">
          <MethodRow
            icon={<GoogleIcon />}
            name="Google"
            statusText={googleEmail ? `已綁定 · ${googleEmail}` : "尚未綁定"}
            statusOn={Boolean(googleEmail)}
            action={
              googleEmail ? (
                <button
                  type="button"
                  onClick={unbindGoogle}
                  disabled={googleBusy}
                  className="rounded-full border-2 border-penguin-peach bg-white px-5 py-2 text-sm font-black text-penguin-gray disabled:opacity-60"
                >
                  {googleBusy ? "處理中..." : "解除綁定"}
                </button>
              ) : (
                <form action="/api/member/google/start" method="get">
                  <button type="submit" className="rounded-full border-2 border-penguin-peach bg-white px-5 py-2 text-sm font-black text-penguin-gray">
                    連結 Google
                  </button>
                </form>
              )
            }
          />

          <MethodRow
            icon={<LineIcon />}
            iconFillsContainer
            name="LINE"
            statusText={isLineLinked ? `已綁定 · 可用於登入與連線下單紀錄查詢（${dateText(lineLinkedAt)}）` : "尚未綁定"}
            statusOn={isLineLinked}
            action={
              isLineLinked ? (
                <button
                  type="button"
                  onClick={unbindLine}
                  disabled={lineBusy}
                  className="rounded-full border-2 border-penguin-peach bg-white px-5 py-2 text-sm font-black text-penguin-gray disabled:opacity-60"
                >
                  {lineBusy ? "處理中..." : "解除綁定"}
                </button>
              ) : (
                <form action="/api/member/line/start" method="get">
                  <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-5 py-2 text-sm font-black text-white shadow-md">
                    <Link2 size={16} />
                    綁定 LINE
                  </button>
                </form>
              )
            }
          />
        </div>

        <p className="mt-4 text-xs font-bold text-gray-400">LINE 綁定後，下次登入即可直接選擇「使用 LINE 登入」；解除綁定後這個選項會跟著消失。</p>
      </section>
    </div>
  );
}
