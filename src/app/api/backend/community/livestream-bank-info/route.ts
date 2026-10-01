import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import {
  getLivestreamBankAccounts,
  saveLivestreamBankAccounts,
  type LivestreamBankAccountKey,
} from "@/lib/line/livestream-bank-info";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest, mutation = false) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_bank_info_get", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const accounts = await getLivestreamBankAccounts();
    return NextResponse.json({ ok: true, accounts });
  } catch {
    return NextResponse.json({ ok: false, error: "收款帳號設定讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_bank_info_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { accounts?: Partial<Record<LivestreamBankAccountKey, unknown>> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的設定資料。" }, { status: 400 });
  }

  const accounts = body.accounts && typeof body.accounts === "object" ? body.accounts : {};

  try {
    const saved = await saveLivestreamBankAccounts(accounts);
    return NextResponse.json({ ok: true, accounts: saved });
  } catch {
    return NextResponse.json({ ok: false, error: "收款帳號設定儲存失敗，請稍後再試。" }, { status: 500 });
  }
}
