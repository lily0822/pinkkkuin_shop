import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { CommunityLineNotificationKind } from "./community-notifications";

const SETTINGS_TYPE = "community-line-notification-templates";
const MAX_TEMPLATE_LENGTH = 2000;

export const COMMUNITY_ORDER_PAGE_URL = "https://pinkkkuin-community-orders.vercel.app";

export type CommunityLineTemplates = Record<CommunityLineNotificationKind, string>;

export const DEFAULT_COMMUNITY_LINE_TEMPLATES: CommunityLineTemplates = {
  bought: `嗨～以下預購商品已下單完成囉 ♡

本次買到商品：
{{商品清單}}

請前往下方選單的社群訂單頁確認訂單並完成匯款～
系統會顯示本次應匯款金額與付款資訊！

謝謝你的支持 ♡`,
  arrived: `嗨～你有商品到貨囉 ♡

本次已到貨商品：
{{商品清單}}

請前往下方選單的社群訂單頁，
選擇這次要一起處理的商品，
並申請 7-11 出貨或面交唷！`,
  marketplace_ready: `嗨～到貨商品的賣場已開立完成

本次商品：
{{商品清單}}

請點下方連結前往下單，
完成後就等包裹出發啦～

謝謝你支持小企鵝選物 ~`,
};

function normalizeTemplates(input: unknown): CommunityLineTemplates {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const result: CommunityLineTemplates = { ...DEFAULT_COMMUNITY_LINE_TEMPLATES };
  (Object.keys(DEFAULT_COMMUNITY_LINE_TEMPLATES) as CommunityLineNotificationKind[]).forEach((kind) => {
    const value = record[kind];
    if (typeof value === "string" && value.trim()) {
      result[kind] = value.slice(0, MAX_TEMPLATE_LENGTH);
    }
  });
  return result;
}

export async function getCommunityLineTemplates(): Promise<CommunityLineTemplates> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return { ...DEFAULT_COMMUNITY_LINE_TEMPLATES };
    return normalizeTemplates(JSON.parse(data.image));
  } catch {
    return { ...DEFAULT_COMMUNITY_LINE_TEMPLATES };
  }
}

export async function saveCommunityLineTemplate(kind: CommunityLineNotificationKind, text: string): Promise<CommunityLineTemplates> {
  const current = await getCommunityLineTemplates();
  const next = normalizeTemplates({ ...current, [kind]: text });
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert(
      { legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(next) },
      { onConflict: "type" },
    );
  if (error) throw error;
  return next;
}

export function renderCommunityLineTemplate(
  template: string,
  vars: { productList: string; marketplaceUrl?: string },
): string {
  return template
    .replaceAll("{{商品清單}}", vars.productList || "（無符合的商品）")
    .replaceAll("{{社群訂單連結}}", COMMUNITY_ORDER_PAGE_URL)
    .replaceAll("{{賣貨便連結}}", vars.marketplaceUrl || "");
}
