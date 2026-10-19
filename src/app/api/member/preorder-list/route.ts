import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

type ListItemRow = {
  id: string;
  quantity: number;
  created_at: string;
  products: {
    id: string;
    legacy_id: string | null;
    name: string;
    image_url: string | null;
    series_id: string | null;
    product_series: { name: string | null } | null;
  } | null;
  product_variants: { id: string; spec: string | null; price: number | null } | null;
};

type ImageRow = { secure_url: string; sort_order: number | null; is_primary: boolean | null; variant_id: string | null; product_id: string };

// 這個商品/規格的代表圖：規格自己的專屬圖片優先（跟 ProductVariant.
// imageUrl 同一個「有專屬圖才用，沒有退回商品圖」原則），沒有才退回
// 這個商品沒有指定規格的共用圖片，再沒有才退回 products.image_url。
function pickItemImage(images: ImageRow[], productId: string, variantId: string | null, fallbackUrl: string | null): string {
  const forProduct = images.filter((image) => image.product_id === productId && image.secure_url);
  const variantImages = variantId ? forProduct.filter((image) => image.variant_id === variantId) : [];
  const pool = variantImages.length ? variantImages : forProduct.filter((image) => !image.variant_id);
  if (pool.length) {
    const sorted = pool.slice().sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
    return sorted.find((image) => image.is_primary)?.secure_url || sorted[0].secure_url;
  }
  return fallbackUrl || "";
}

// 預購清單讀取：authenticated 角色對 products/product_variants 這兩張
// 表沒有 schema grant（跟 add_to_preorder_list 那次發現的限制一樣），
// 要 join 商品/規格資料一定要用 service client；user_id 只能來自這裡
// 用 session 查到的真實值，絕不接受前端傳入的任何 id。
export async function GET(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  // 比照 /api/member/livestream-orders 的慣例：沒綁定 LINE 不是噴錯誤，
  // 回 200 + linked:false + 空清單，讓抽屜/標頭可以顯示「請先綁定」的
  // 提示文字，不是當成讀取失敗處理。
  const { data: binding } = await supabase
    .from("member_line_accounts")
    .select("line_user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!binding?.line_user_id) {
    return NextResponse.json({ ok: true, linked: false, items: [] });
  }

  const service = createSupabaseServiceClient();
  const { data: rows, error } = await service
    .from("preorder_list_items")
    .select(
      "id,quantity,created_at,products(id,legacy_id,name,image_url,series_id,product_series(name)),product_variants(id,spec,price)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<ListItemRow[]>();

  if (error) return authJsonError("預購清單讀取失敗，請稍後再試。", 500);

  const productIds = Array.from(new Set((rows || []).map((row) => row.products?.id).filter((id): id is string => Boolean(id))));
  let images: ImageRow[] = [];
  if (productIds.length) {
    const { data: imageRows } = await service
      .from("product_images")
      .select("secure_url,sort_order,is_primary,variant_id,product_id")
      .in("product_id", productIds)
      .returns<ImageRow[]>();
    images = imageRows || [];
  }

  const items = (rows || [])
    .filter((row) => row.products)
    .map((row) => {
      const product = row.products!;
      const variant = row.product_variants;
      const unitPrice = Number(variant?.price ?? 0);
      return {
        id: row.id,
        productId: product.legacy_id || product.id,
        productName: product.name,
        variantSpec: variant?.spec || null,
        seriesName: product.product_series?.name || null,
        image: pickItemImage(images, product.id, variant?.id || null, product.image_url),
        quantity: row.quantity,
        unitPrice,
        createdAt: row.created_at,
      };
    });

  return NextResponse.json({ ok: true, linked: true, items });
}

// 加入預購清單：寫入 preorder_list_items 的同商品/同規格累加語意是靠
// DB 端的 add_to_preorder_list() RPC 做的（202610180001）——那張表的
// 唯一性是運算式 index，PostgREST 的 upsert on_conflict 沒辦法對應，
// 所以不在這裡用 .upsert()，直接呼叫 RPC。RPC 本身也會重新驗證商品/
// 規格是不是真的存在、是不是預購中的上架商品，不信任這裡傳進來的任何
// 商品資料，只信任 auth.uid()。
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  let body: { productId?: unknown; variantId?: unknown; quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const productId = String(body.productId || "").trim();
  if (!productId) return authJsonError("請提供正確的商品。");
  const variantId = body.variantId ? String(body.variantId).trim() : null;
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));

  const { data, error } = await supabase.rpc("add_to_preorder_list", {
    p_product_id: productId,
    p_variant_id: variantId,
    p_quantity: quantity,
  });

  if (error) return authJsonError(error.message || "加入預購清單失敗，請稍後再試。", 400);
  return NextResponse.json({ ok: true, quantity: (data as { quantity?: number } | null)?.quantity ?? quantity });
}
