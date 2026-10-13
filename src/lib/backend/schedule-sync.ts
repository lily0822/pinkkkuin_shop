import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡
// syncSupabaseStallSchedule/syncSupabaseConnectionSchedule/
// readSupabaseStallSchedules/readSupabaseConnectionSchedules 的邏輯原樣
// 搬過來——src/lib/storefront-schedules.ts 的 getPublicSchedules() 早就
// 已經直接讀這兩張表了（前台這端本來就活在 Supabase），這次只是把
// 「後台存檔」這個動作也改接過去。

export type BackendScheduleType = "stall" | "connection";

export type BackendStallSchedulePayload = {
  id?: string | number;
  period?: string;
  location?: string;
  image?: string;
  stallFee?: number;
  days?: unknown;
};

export type BackendConnectionSchedulePayload = {
  id?: string | number;
  period?: string;
  location?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  flightFee?: number;
  hotelFee?: number;
};

export type BackendStallSchedule = {
  id: string;
  period: string;
  location: string;
  image: string;
  stallFee: number;
  days: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type BackendConnectionSchedule = {
  id: string;
  period: string;
  location: string;
  image: string;
  startDate: string;
  endDate: string;
  flightFee: number;
  hotelFee: number;
  createdAt: string;
  updatedAt: string;
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

type RawStallRow = {
  id: string;
  legacy_id: string | null;
  period: string | null;
  location: string | null;
  image: string | null;
  stall_fee: number | null;
  days: unknown;
  created_at: string | null;
  updated_at: string | null;
};

type RawConnectionRow = {
  id: string;
  legacy_id: string | null;
  period: string | null;
  location: string | null;
  image: string | null;
  start_date: string | null;
  end_date: string | null;
  flight_fee: number | null;
  hotel_fee: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function listBackendStallSchedules(): Promise<BackendStallSchedule[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("stall_schedules")
    .select("id,legacy_id,period,location,image,stall_fee,days,created_at,updated_at")
    .order("created_at", { ascending: false })
    .returns<RawStallRow[]>();
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.legacy_id || row.id),
    period: row.period || "",
    location: row.location || "",
    image: row.image || "",
    stallFee: Number(row.stall_fee || 0),
    days: Array.isArray(row.days) ? row.days : [],
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }));
}

export async function listBackendConnectionSchedules(): Promise<BackendConnectionSchedule[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("connection_schedules")
    .select("id,legacy_id,period,location,image,start_date,end_date,flight_fee,hotel_fee,created_at,updated_at")
    .order("created_at", { ascending: false })
    .returns<RawConnectionRow[]>();
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.legacy_id || row.id),
    period: row.period || "",
    location: row.location || "",
    image: row.image || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    flightFee: Number(row.flight_fee || 0),
    hotelFee: Number(row.hotel_fee || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }));
}

export async function saveBackendStallSchedule(schedule: BackendStallSchedulePayload): Promise<BackendStallSchedule> {
  if (!schedule) throw new Error("請提供擺攤時程資料。");
  const legacyId = String(schedule.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("stall_schedules")
    .upsert(
      {
        legacy_id: legacyId,
        period: schedule.period || "",
        location: schedule.location || "",
        image: schedule.image || "",
        stall_fee: Number(schedule.stallFee || 0),
        days: parseJsonArray(schedule.days),
      },
      { onConflict: "legacy_id" },
    )
    .select("id,legacy_id,period,location,image,stall_fee,days,created_at,updated_at")
    .limit(1)
    .returns<RawStallRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 擺攤時程儲存未回傳資料。");
  return {
    id: String(row.legacy_id || row.id),
    period: row.period || "",
    location: row.location || "",
    image: row.image || "",
    stallFee: Number(row.stall_fee || 0),
    days: Array.isArray(row.days) ? row.days : [],
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function saveBackendConnectionSchedule(
  schedule: BackendConnectionSchedulePayload,
): Promise<BackendConnectionSchedule> {
  if (!schedule) throw new Error("請提供連線時程資料。");
  const legacyId = String(schedule.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("connection_schedules")
    .upsert(
      {
        legacy_id: legacyId,
        period: schedule.period || "",
        location: schedule.location || "",
        image: schedule.image || "",
        start_date: schedule.startDate || null,
        end_date: schedule.endDate || null,
        flight_fee: Number(schedule.flightFee || 0),
        hotel_fee: Number(schedule.hotelFee || 0),
      },
      { onConflict: "legacy_id" },
    )
    .select("id,legacy_id,period,location,image,start_date,end_date,flight_fee,hotel_fee,created_at,updated_at")
    .limit(1)
    .returns<RawConnectionRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 連線時程儲存未回傳資料。");
  return {
    id: String(row.legacy_id || row.id),
    period: row.period || "",
    location: row.location || "",
    image: row.image || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    flightFee: Number(row.flight_fee || 0),
    hotelFee: Number(row.hotel_fee || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function deleteBackendStallSchedule(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("stall_schedules").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}

export async function deleteBackendConnectionSchedule(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("connection_schedules").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}
