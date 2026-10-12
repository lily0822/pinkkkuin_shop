import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 livestream-keywords.ts 的 schedule_settings KV 模式，不開新表。
// 讀取失敗/還沒設定過時一律 fallback 回「全部啟用＋預設文字」，不會
// 因為設定讀取失敗就意外把前台擋掉。
const SETTINGS_TYPE = "site-feature-flags";
const MAX_MESSAGE_LENGTH = 200;
const DEFAULT_MESSAGE = "目前暫停服務，造成不便敬請見諒。";

export type SiteFeatureFlag = "signup" | "login";
// 之後要加其他頁面的開關，往這個 union type 加一個新值即可。

export const SITE_FEATURE_FLAGS: SiteFeatureFlag[] = ["signup", "login"];
export const SITE_FEATURE_FLAG_LABELS: Record<SiteFeatureFlag, string> = {
  signup: "會員註冊",
  login: "會員登入",
};

export type SiteFeatureFlagState = { enabled: boolean; message: string };
export type SiteFeatureFlagSettings = Record<SiteFeatureFlag, SiteFeatureFlagState>;

function defaultSettings(): SiteFeatureFlagSettings {
  const result = {} as SiteFeatureFlagSettings;
  SITE_FEATURE_FLAGS.forEach((flag) => {
    result[flag] = { enabled: true, message: DEFAULT_MESSAGE };
  });
  return result;
}

function sanitizeSettings(input: Partial<Record<SiteFeatureFlag, unknown>>): SiteFeatureFlagSettings {
  const result = {} as SiteFeatureFlagSettings;
  SITE_FEATURE_FLAGS.forEach((flag) => {
    const raw = input[flag];
    const record = raw && typeof raw === "object" ? (raw as { enabled?: unknown; message?: unknown }) : {};
    const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
    const message =
      typeof record.message === "string" && record.message.trim() ? record.message.trim().slice(0, MAX_MESSAGE_LENGTH) : DEFAULT_MESSAGE;
    result[flag] = { enabled, message };
  });
  return result;
}

export async function getSiteFeatureFlags(): Promise<SiteFeatureFlagSettings> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.from("schedule_settings").select("image").eq("type", SETTINGS_TYPE).maybeSingle();
    if (error || !data?.image) return defaultSettings();
    return sanitizeSettings(JSON.parse(data.image) as Partial<Record<SiteFeatureFlag, unknown>>);
  } catch {
    return defaultSettings();
  }
}

export async function getSiteFeatureFlag(flag: SiteFeatureFlag): Promise<SiteFeatureFlagState> {
  const settings = await getSiteFeatureFlags();
  return settings[flag];
}

export async function isSiteFeatureEnabled(flag: SiteFeatureFlag): Promise<boolean> {
  const state = await getSiteFeatureFlag(flag);
  return state.enabled;
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
