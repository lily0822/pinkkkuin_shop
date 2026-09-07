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

async function getUserClient(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response: unauthorized(), supabase: null, userId: "" };
  if (await isMemberDisabled(supabase, data.user.id)) {
    return { response: authJsonError("會員帳號目前已停用。", 403), supabase: null, userId: "" };
  }
  return { response, supabase, userId: data.user.id };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response, supabase, userId } = await getUserClient(request);
  if (!supabase) return response;
  const { id } = await params;
  const addressId = id.trim();
  if (!addressId) return authJsonError("地址資料不存在。", 404);

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
      .eq("user_id", userId)
      .eq("is_default", true)
      .neq("id", addressId);
    if (clearError) return authJsonError("地址資料儲存失敗，請稍後再試。", 500);
  }

  const { data, error } = await supabase
    .from("member_addresses")
    .update({
      recipient_name: input.recipientName,
      phone: input.phone,
      postal_code: input.postalCode,
      city: input.city,
      district: input.district,
      address_line: input.addressLine,
      is_default: input.isDefault,
    })
    .eq("id", addressId)
    .eq("user_id", userId)
    .select("id,recipient_name,phone,postal_code,city,district,address_line,is_default")
    .maybeSingle();

  if (error) return authJsonError("地址資料儲存失敗，請稍後再試。", 500);
  if (!data) return authJsonError("地址資料不存在。", 404);
  return NextResponse.json({ ok: true, address: mapAddress(data) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response, supabase, userId } = await getUserClient(request);
  if (!supabase) return response;
  const { id } = await params;
  const addressId = id.trim();
  if (!addressId) return authJsonError("地址資料不存在。", 404);

  const { error } = await supabase
    .from("member_addresses")
    .delete()
    .eq("id", addressId)
    .eq("user_id", userId);

  if (error) return authJsonError("地址資料刪除失敗，請稍後再試。", 500);
  return NextResponse.json({ ok: true });
}
