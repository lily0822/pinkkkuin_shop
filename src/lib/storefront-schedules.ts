import { cache } from "react";

type StallScheduleRow = {
  id: string;
  legacy_id: string | null;
  period: string | null;
  location: string | null;
  image: string | null;
  stall_fee: number | string | null;
  days: unknown;
};

type ConnectionScheduleRow = {
  id: string;
  legacy_id: string | null;
  period: string | null;
  location: string | null;
  image: string | null;
  start_date: string | null;
  end_date: string | null;
  flight_fee: number | string | null;
  hotel_fee: number | string | null;
};

export type ScheduleEventStatus = "upcoming" | "ongoing" | "ended";

export type ScheduleEventDay = {
  date: string;
  startTime?: string;
  endTime?: string;
};

export type ScheduleEventAmount = {
  label: string;
  amount: number;
};

export type PublicScheduleEvent = {
  id: string;
  type: "connection" | "stall";
  title: string;
  location?: string;
  imageUrl?: string;
  startDate?: string;
  endDate?: string;
  days: ScheduleEventDay[];
  amounts: ScheduleEventAmount[];
  status: ScheduleEventStatus;
};

export type PublicSchedules = {
  connections: PublicScheduleEvent[];
  stalls: PublicScheduleEvent[];
};

function supabaseConfig() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl || !key) return null;
  return {
    baseUrl,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  };
}

async function readRows<T>(path: string): Promise<T[]> {
  const config = supabaseConfig();
  if (!config) return [];
  const response = await fetch(`${config.baseUrl}/rest/v1/${path}`, {
    headers: config.headers,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase schedule fetch failed (${response.status})`);
  return (await response.json()) as T[];
}

function optionalText(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function scheduleAmount(label: string, value: unknown): ScheduleEventAmount | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? { label, amount } : null;
}

function dateTimeValue(date?: string, time?: string, endOfDay = false) {
  if (!date) return Number.NaN;
  const clock = time || (endOfDay ? "23:59:59.999" : "00:00:00");
  return new Date(`${date}T${clock}+08:00`).getTime();
}

export function getScheduleEventStatus(startDate?: string, endDate?: string, startTime?: string, endTime?: string, now = Date.now()): ScheduleEventStatus {
  const start = dateTimeValue(startDate, startTime);
  const end = dateTimeValue(endDate, endTime, !endTime);
  if (Number.isFinite(start) && now < start) return "upcoming";
  if (Number.isFinite(end) && now >= end) return "ended";
  return "ongoing";
}

function normalizeDays(value: unknown): ScheduleEventDay[] {
  let source = value;
  if (typeof value === "string") {
    try { source = JSON.parse(value); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  return source
    .map((item): ScheduleEventDay | null => {
      const row = item as Record<string, unknown>;
      const date = optionalText(row.date);
      if (!date) return null;
      return {
        date,
        startTime: optionalText(row.startTime ?? row.start_time),
        endTime: optionalText(row.endTime ?? row.end_time),
      };
    })
    .filter((day): day is ScheduleEventDay => Boolean(day))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function eventSortValue(event: PublicScheduleEvent) {
  return event.days[0]?.date || event.startDate || event.endDate || "9999-12-31";
}

function sortEvents(events: PublicScheduleEvent[]) {
  const statusOrder: Record<ScheduleEventStatus, number> = { ongoing: 0, upcoming: 1, ended: 2 };
  return events.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || eventSortValue(a).localeCompare(eventSortValue(b)));
}

function mapConnections(rows: ConnectionScheduleRow[]): PublicScheduleEvent[] {
  return sortEvents(rows.map((row) => ({
    id: row.legacy_id || row.id,
    type: "connection",
    title: optionalText(row.period) || "代購連線",
    location: optionalText(row.location),
    imageUrl: optionalText(row.image),
    startDate: optionalText(row.start_date),
    endDate: optionalText(row.end_date),
    days: [],
    amounts: [
      scheduleAmount("機票費", row.flight_fee),
      scheduleAmount("住宿費", row.hotel_fee),
    ].filter((amount): amount is ScheduleEventAmount => Boolean(amount)),
    status: getScheduleEventStatus(optionalText(row.start_date), optionalText(row.end_date)),
  })));
}

function mapStalls(rows: StallScheduleRow[]): PublicScheduleEvent[] {
  return sortEvents(rows.map((row) => {
    const days = normalizeDays(row.days);
    const firstDay = days[0];
    const lastDay = days.at(-1);
    return {
      id: row.legacy_id || row.id,
      type: "stall",
      title: optionalText(row.period) || "市集出攤",
      location: optionalText(row.location),
      imageUrl: optionalText(row.image),
      startDate: firstDay?.date,
      endDate: lastDay?.date,
      days,
      amounts: [scheduleAmount("攤位費", row.stall_fee)].filter((amount): amount is ScheduleEventAmount => Boolean(amount)),
      status: getScheduleEventStatus(firstDay?.date, lastDay?.date, firstDay?.startTime, lastDay?.endTime),
    };
  }));
}

export const getPublicSchedules = cache(async function getPublicSchedules(): Promise<PublicSchedules> {
  try {
    const [connections, stalls] = await Promise.all([
      readRows<ConnectionScheduleRow>("connection_schedules?select=id,legacy_id,period,location,image,start_date,end_date,flight_fee,hotel_fee&order=updated_at.desc"),
      readRows<StallScheduleRow>("stall_schedules?select=id,legacy_id,period,location,image,stall_fee,days&order=updated_at.desc"),
    ]);
    return { connections: mapConnections(connections), stalls: mapStalls(stalls) };
  } catch (error) {
    console.warn("Public schedules fetch failed", error);
    return { connections: [], stalls: [] };
  }
});
