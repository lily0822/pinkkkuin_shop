import "server-only";

import { unstable_cache } from "next/cache";
import { cache } from "react";
import { isWithinSchedule } from "@/lib/appearance-settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 livestream-keywords.ts 的 schedule_settings KV 模式，不開新表。
// 讀取失敗/還沒設定過時一律 fallback 回「全部啟用＋預設文字」，不會
// 因為設定讀取失敗就意外把前台擋掉。
const SETTINGS_TYPE = "site-feature-flags";
const MAX_MESSAGE_LENGTH = 200;
const DEFAULT_MESSAGE = "目前暫停服務，造成不便敬請見諒。";

export type SiteFeatureFlag = "signup" | "login" | "products" | "stock" | "preorder" | "live_order";
// 之後要加其他頁面的開關，往這個 union type 加一個新值即可。

export const SITE_FEATURE_FLAGS: SiteFeatureFlag[] = ["signup", "login", "products", "stock", "preorder", "live_order"];
export const SITE_FEATURE_FLAG_LABELS: Record<SiteFeatureFlag, string> = {
  signup: "會員註冊",
  login: "會員登入",
  products: "全部商品",
  stock: "現貨",
  preorder: "預購",
  live_order: "代購/市集",
};

export type SiteFeatureFlagState = {
  enabled: boolean;
  message: string;
  // ISO 字串；留空代表沒有排程，純粹只看 enabled。
  maintenanceStart: string;
  maintenanceEnd: string;
};
export type SiteFeatureFlagSettings = Record<SiteFeatureFlag, SiteFeatureFlagState>;

function defaultState(): SiteFeatureFlagState {
  return { enabled: true, message: DEFAULT_MESSAGE, maintenanceStart: "", maintenanceEnd: "" };
}

function defaultSettings(): SiteFeatureFlagSettings {
  const result = {} as SiteFeatureFlagSettings;
  SITE_FEATURE_FLAGS.forEach((flag) => {
    result[flag] = defaultState();
  });
  return result;
}

function sanitizeMaintenanceTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : value.trim();
}

function sanitizeSettings(input: Partial<Record<SiteFeatureFlag, unknown>>): SiteFeatureFlagSettings {
  const result = {} as SiteFeatureFlagSettings;
  SITE_FEATURE_FLAGS.forEach((flag) => {
    const raw = input[flag];
    const record =
      raw && typeof raw === "object"
        ? (raw as { enabled?: unknown; message?: unknown; maintenanceStart?: unknown; maintenanceEnd?: unknown })
        : {};
    const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
    const message =
      typeof record.message === "string" && record.message.trim() ? record.message.trim().slice(0, MAX_MESSAGE_LENGTH) : DEFAULT_MESSAGE;
    result[flag] = {
      enabled,
      message,
      maintenanceStart: sanitizeMaintenanceTime(record.maintenanceStart),
      maintenanceEnd: sanitizeMaintenanceTime(record.maintenanceEnd),
    };
  });
  return result;
}

// 兩層快取：unstable_cache 跨請求（45 秒，或後台存檔時 revalidateTag
// ("site-feature-flags") 手動失效，見 /api/backend/site-feature-flags
// 的 POST），外層 React cache() 同一個請求內去重、順便防 cache
// stampede（理由跟 appearance-settings.ts/brand-settings.ts 一樣）。
const fetchSiteFeatureFlagsCached = unstable_cache(
  async function getSiteFeatureFlags(): Promise<SiteFeatureFlagSettings> {
    try {
      const supabase = createSupabaseServiceClient();
      const { data, error } = await supabase.from("schedule_settings").select("image").eq("type", SETTINGS_TYPE).maybeSingle();
      if (error || !data?.image) return defaultSettings();
      return sanitizeSettings(JSON.parse(data.image) as Partial<Record<SiteFeatureFlag, unknown>>);
    } catch {
      return defaultSettings();
    }
  },
  ["site-feature-flags-v1"],
  { revalidate: 45, tags: ["site-feature-flags"] },
);

export const getSiteFeatureFlags = cache(fetchSiteFeatureFlagsCached);

export async function getSiteFeatureFlag(flag: SiteFeatureFlag): Promise<SiteFeatureFlagState> {
  const settings = await getSiteFeatureFlags();
  return settings[flag];
}

// 手動 enabled=false 一定擋；enabled=true 但現在時間落在維護時間
// 區間內，自動視為停用——每次讀取當下即時判斷，不需要額外排程工作。
// 沒設定維護時間（兩個欄位都留空）就單純看手動開關，不受影響。
export function isEffectivelyEnabled(state: SiteFeatureFlagState, now: number = Date.now()): boolean {
  if (!state.enabled) return false;
  const hasMaintenanceWindow = Boolean(state.maintenanceStart) || Boolean(state.maintenanceEnd);
  if (hasMaintenanceWindow && isWithinSchedule(state.maintenanceStart || undefined, state.maintenanceEnd || undefined, now)) {
    return false;
  }
  return true;
}

export async function isSiteFeatureEnabled(flag: SiteFeatureFlag): Promise<boolean> {
  const state = await getSiteFeatureFlag(flag);
  return isEffectivelyEnabled(state);
}

function formatMaintenanceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

// 管理員自訂的 message 後面自動附加這段，不用自己把時間打進文字裡。
export function formatMaintenanceWindow(state: SiteFeatureFlagState): string {
  const start = state.maintenanceStart ? formatMaintenanceTime(state.maintenanceStart) : "";
  const end = state.maintenanceEnd ? formatMaintenanceTime(state.maintenanceEnd) : "";
  if (!start && !end) return "";
  if (start && end) return `（維護時間：${start} - ${end}）`;
  if (start) return `（維護時間：${start} 起）`;
  return `（維護時間：至 ${end}）`;
}

export function getDisabledMessage(state: SiteFeatureFlagState): string {
  const window = formatMaintenanceWindow(state);
  return window ? `${state.message}${window}` : state.message;
}

export async function saveSiteFeatureFlags(next: Partial<Record<SiteFeatureFlag, unknown>>): Promise<SiteFeatureFlagSettings> {
  const sanitized = sanitizeSettings(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(sanitized) }, { onConflict: "type" });
  if (error) throw error;
  return sanitized;
}
