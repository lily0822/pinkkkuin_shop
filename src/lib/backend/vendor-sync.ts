import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡
// syncSupabaseVendor/syncSupabaseWebsite/readSupabaseVendors/
// readSupabaseWebsites 的邏輯原樣搬過來——vendors/websites 這兩張表
// 早就已經透過 Apps Script 的 safeSupabaseMirror 持續同步，readData()
// 也早就優先讀 Supabase，這次只是把「後台存檔」這個動作也改接過去。
// 這兩張表欄位幾乎一樣（只差 websites 多一個 link），放同一個檔案。

export type BackendVendorPayload = {
  id?: string | number;
  name: string;
  contact?: string;
  location?: string;
  currency?: string;
  notes?: string;
};

export type BackendVendor = {
  id: string;
  name: string;
  contact: string;
  location: string;
  currency: string;
  notes: string;
};

export type BackendWebsitePayload = {
  id?: string | number;
  name: string;
  contact?: string;
  location?: string;
  currency?: string;
  link?: string;
  notes?: string;
};

export type BackendWebsite = {
  id: string;
  name: string;
  contact: string;
  location: string;
  currency: string;
  link: string;
  notes: string;
};

type RawVendorRow = {
  id: string;
  legacy_id: string | null;
  name: string | null;
  contact: string | null;
  location: string | null;
  currency: string | null;
  notes: string | null;
};

type RawWebsiteRow = RawVendorRow & { link: string | null };

export async function listBackendVendors(): Promise<BackendVendor[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id,legacy_id,name,contact,location,currency,notes")
    .order("created_at", { ascending: true })
    .returns<RawVendorRow[]>();
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.legacy_id || row.id),
    name: row.name || "",
    contact: row.contact || "",
    location: row.location || "",
    currency: row.currency || "",
    notes: row.notes || "",
  }));
}

export async function saveBackendVendor(vendor: BackendVendorPayload): Promise<BackendVendor> {
  if (!vendor || !vendor.name) throw new Error("請填寫廠商名稱。");
  const legacyId = String(vendor.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("vendors")
    .upsert(
      {
        legacy_id: legacyId,
        name: vendor.name || "",
        contact: vendor.contact || "",
        location: vendor.location || "",
        currency: vendor.currency || "",
        notes: vendor.notes || "",
      },
      { onConflict: "legacy_id" },
    )
    .select("id,legacy_id,name,contact,location,currency,notes")
    .limit(1)
    .returns<RawVendorRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 廠商儲存未回傳資料。");
  return { id: String(row.legacy_id || row.id), name: row.name || "", contact: row.contact || "", location: row.location || "", currency: row.currency || "", notes: row.notes || "" };
}

export async function deleteBackendVendor(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("vendors").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}

export async function listBackendWebsites(): Promise<BackendWebsite[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("websites")
    .select("id,legacy_id,name,contact,location,currency,link,notes")
    .order("created_at", { ascending: true })
    .returns<RawWebsiteRow[]>();
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.legacy_id || row.id),
    name: row.name || "",
    contact: row.contact || "",
    location: row.location || "",
    currency: row.currency || "",
    link: row.link || "",
    notes: row.notes || "",
  }));
}

export async function saveBackendWebsite(website: BackendWebsitePayload): Promise<BackendWebsite> {
  if (!website || !website.name) throw new Error("請填寫購物網站名稱。");
  const legacyId = String(website.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("websites")
    .upsert(
      {
        legacy_id: legacyId,
        name: website.name || "",
        contact: website.contact || "",
        location: website.location || "",
        currency: website.currency || "",
        link: website.link || "",
        notes: website.notes || "",
      },
      { onConflict: "legacy_id" },
    )
    .select("id,legacy_id,name,contact,location,currency,link,notes")
    .limit(1)
    .returns<RawWebsiteRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 購物網站儲存未回傳資料。");
  return {
    id: String(row.legacy_id || row.id),
    name: row.name || "",
    contact: row.contact || "",
    location: row.location || "",
    currency: row.currency || "",
    link: row.link || "",
    notes: row.notes || "",
  };
}

export async function deleteBackendWebsite(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("websites").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}
