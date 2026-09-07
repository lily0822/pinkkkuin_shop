import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { normalizeAddressInput, validateAddressInput } from "@/lib/member/validation";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

function mapAddress(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    recipientName: String(row.recipient_name || ""),
    phone: String(row.phone || ""),
    postalCode: String(row.postal_code || ""),
    city: String(row.city || ""),
    district: String(row.district || ""),
    addressLine: String(row.address_line || ""),
    isDefault: Boolean(row.is_default),
  };
}

export async function GET(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  const { data, error } = await supabase
    .from("member_addresses")
    .select("id,recipient_name,phone,postal_code,city,district,address_line,is_default,created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return authJsonError("地址資料讀取失敗，請稍後再試。", 500);
  return NextResponse.json({ ok: true, addresses: (data || []).map(mapAddress) });
}

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const input = normalizeAddressInput(body);
  const validationError = validateAddressInput(input);
  if (validationError) return authJsonError(validationError);

  if (input.isDefault) {
    const { error: clearError } = await supabase
      .from("member_addresses")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("is_default", true);
    if (clearError) return authJsonError("地址資料儲存失敗，請稍後再試。", 500);
  }

  const { data, error } = await supabase
    .from("member_addresses")
    .insert({
      user_id: user.id,
      recipient_name: input.recipientName,
      phone: input.phone,
      postal_code: input.postalCode,
      city: input.city,
      district: input.district,
      address_line: input.addressLine,
      is_default: input.isDefault,
    })
    .select("id,recipient_name,phone,postal_code,city,district,address_line,is_default")
    .single();

  if (error) return authJsonError("地址資料儲存失敗，請稍後再試。", 500);
  return NextResponse.json({ ok: true, address: mapAddress(data) });
}
