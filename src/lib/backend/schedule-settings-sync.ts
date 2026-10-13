import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡
// syncSupabaseScheduleSetting()/readSupabaseScheduleSettings() 的邏輯
// 原樣搬過來。品牌名稱/Logo/Logo庫/浮水印/文字圖、網站資訊、首頁內容
// （公告/輪播/首頁區塊/導覽列）、側邊欄模組順序、商品預設佔位圖，這些
// 看起來分屬不同頁籤的設定，GAS 端其實全部都是透過同一支
// syncSupabaseScheduleSetting(setting) 寫進同一張 schedule_settings
// 表、用 type 當 key 的通用 KV 機制——跟 livestream-keywords/
// livestream-bank-info/site-feature-flags 用的是同一套模式，不是分開
// 各自一套邏輯。這裡沿用同一支通用函式，不要為每個 type 各寫一份。
//
// 其中 4 類（brand/site-info/homepage 系列/product-default）前台
// 已經直接讀 Supabase 的 schedule_settings 表了（src/lib/brand-settings.ts、
// src/lib/appearance-settings.ts、src/lib/product-default-image.ts）；
// 其餘幾類（brand-logo-scale/brand-watermark/brand-text-image/
// backend-module-order/stall/connection/product-default-scale）目前
// 只有後台自己的 doGet() 會讀回來，storefront 沒有消費者。這次只是把
// 「後台存檔」這個動作也改接過去，讀/寫欄位形狀不變。

export type BackendScheduleSetting = {
  type: string;
  image: string;
  createdAt: string;
  updatedAt: string;
};

type RawScheduleSettingRow = {
  type: string | null;
  image: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function mapRow(row: RawScheduleSettingRow): BackendScheduleSetting {
  return {
    type: row.type || "",
    image: row.image || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

// 不傳 types 時回傳全部——這張表目前只有十幾筆資料，整包撈回來比起
// 再另外維護一份「後台到底用了哪些 type」的清單更不容易漏掉。
export async function listBackendScheduleSettings(types?: string[]): Promise<BackendScheduleSetting[]> {
  const supabase = createSupabaseServiceClient();
  let query = supabase.from("schedule_settings").select("type,image,created_at,updated_at").order("created_at", { ascending: true });
  if (types && types.length) query = query.in("type", types);
  const { data, error } = await query.returns<RawScheduleSettingRow[]>();
  if (error) throw error;
  return (data || []).map(mapRow);
}

// 比照 .gs doPost 裡 saveScheduleSetting 這個 action 的特例：
// type === 'product-default' 時要先把 image 正規化成本地 /images/xxx
// 相對路徑（如果不是完整 http(s) 網址或本地圖片格式，一律清空）。
function normalizeProductDefaultImage(image: string): string {
  const raw = String(image || "").trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) return "";
  const clean = raw.replace(/[?#].*$/, "").replace(/\\/g, "/");
  const relative = clean.replace(/^\/?images\//i, "").replace(/^\/+/, "");
  if (!relative || relative.split("/").includes("..")) return "";
  if (!/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(relative)) return "";
  return "/images/" + relative;
}

export async function saveBackendScheduleSetting(type: string, image: string): Promise<BackendScheduleSetting> {
  if (!type) throw new Error("請提供設定的 type。");
  const value = type === "product-default" ? normalizeProductDefaultImage(image) : String(image ?? "");
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: type, type, image: value }, { onConflict: "type" })
    .select("type,image,created_at,updated_at")
    .limit(1)
    .returns<RawScheduleSettingRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 設定儲存未回傳資料。");
  return mapRow(row);
}
