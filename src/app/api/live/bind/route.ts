import { NextRequest, NextResponse } from "next/server";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getLiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import { submitLiveIdentity } from "@/lib/line/live-identity-rpc";
import { validateLiveBindingValue, type LiveBindingType } from "@/lib/line/live-identity-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function conflictMessage(type: LiveBindingType) {
  return type === "ig"
    ? "這個 IG 帳號已經有人綁定了。如果你就是本人，請聯絡賣家處理。"
    : "這個暱稱已經有人綁定了。如果你就是本人，請聯絡賣家處理。";
}

export async function POST(request: NextRequest) {
  let body: { token?: unknown; type?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyLivestreamMagicLink(token, "bind");
  if (!payload) {
    return NextResponse.json({ ok: false, error: "連結已過期，請回到 LINE 重新輸入「綁定」。" }, { status: 401 });
  }

  const type = body.type === "ig" ? "ig" : body.type === "nickname" ? "nickname" : null;
  if (!type) {
    return NextResponse.json({ ok: false, error: "請選擇綁定類型。" }, { status: 400 });
  }
  const rawValue = typeof body.value === "string" ? body.value : "";

  // 伺服器端是權威驗證，不信任前端——即使前端已經擋過一次，這裡再驗
  // 一次格式（正規化邏輯跟前端共用同一支 validateLiveBindingValue，不
  // 會兩邊規則飄走）。
  const validation = validateLiveBindingValue(type, rawValue);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.message }, { status: 400 });
  }

  const identity = await getLiveCustomerIdentity(payload.lineUserId);

  const result = await submitLiveIdentity({
    lineUserId: payload.lineUserId,
    lineDisplayName: identity.lineName,
    bindingType: type,
    bindingValue: validation.value,
    actor: "customer",
  });

  if (!result.ok) {
    if (result.error === "conflict") {
      return NextResponse.json({ ok: false, error: conflictMessage(type) }, { status: 409 });
    }
    if (result.error === "unchanged") {
      return NextResponse.json({ ok: false, error: "這跟你目前綁定的一樣，沒有需要修改的地方。" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "綁定失敗，請稍後再試一次。" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    binding: { type: result.identity.bindingType, value: result.identity.bindingValue },
  });
}
