import { CalendarDays, Clock3, MapPin, Radio, Store } from "lucide-react";
import type { PublicScheduleEvent, ScheduleEventStatus } from "@/lib/storefront-schedules";

type LiveMarketInfoProps = {
  connections: PublicScheduleEvent[];
  stalls: PublicScheduleEvent[];
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const STATUS_LABELS: Record<ScheduleEventStatus, string> = {
  upcoming: "即將開始",
  ongoing: "進行中",
  ended: "已結束",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(`${date}T00:00:00+08:00`));
}

function taipeiDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function addDateRange(target: Set<string>, startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return;
  const start = new Date(`${startDate || endDate}T00:00:00Z`);
  const end = new Date(`${endDate || startDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
  for (let date = start, count = 0; date <= end && count < 367; date = new Date(date.getTime() + 86400000), count += 1) {
    target.add(date.toISOString().slice(0, 10));
  }
}

function eventDateKeys(events: PublicScheduleEvent[]) {
  const keys = new Set<string>();
  events.forEach((event) => {
    if (event.days.length) event.days.forEach((day) => keys.add(day.date));
    else addDateRange(keys, event.startDate, event.endDate);
  });
  return keys;
}

function Calendar({ connections, stalls }: LiveMarketInfoProps) {
  const today = taipeiDateKey();
  const connectionDates = eventDateKeys(connections);
  const stallDates = eventDateKeys(stalls);
  const markedDates = [...new Set([...connectionDates, ...stallDates])].sort();
  const focusDate = markedDates.find((date) => date >= today) || markedDates.at(-1) || today;
  const [year, month] = focusDate.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ key: string; day?: number }> = [
    ...Array.from({ length: firstWeekday }, (_, index) => ({ key: `empty-${index}` })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { key, day };
    }),
  ];

  return (
    <section className="rounded-3xl border-2 border-penguin-peach bg-white p-3 sm:p-4">
      <div className="flex flex-col items-stretch gap-2">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-penguin-pink-light text-penguin-pink-dark"><CalendarDays size={18} /></span>
          <div>
            <h2 className="font-black text-penguin-gray">{year} 年 {month} 月</h2>
            <p className="text-xs font-bold text-gray-500">活動行事曆</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 self-end text-[11px] font-bold text-gray-500">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-penguin-pink-dark" />代購連線</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-brand-mint" />市集出攤</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center sm:gap-1">
        {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1 text-xs font-black text-gray-400">{weekday}</div>)}
        {cells.map((cell) => cell.day ? (
          <div key={cell.key} className={`relative grid aspect-square min-w-0 place-items-center rounded-lg text-xs font-bold ${cell.key === today ? "bg-penguin-pink-light text-penguin-pink-dark" : "text-penguin-gray"}`}>
            {cell.day}
            <span className="absolute bottom-0.5 flex gap-0.5">
              {connectionDates.has(cell.key) ? <i className="h-1.5 w-1.5 rounded-full bg-penguin-pink-dark" /> : null}
              {stallDates.has(cell.key) ? <i className="h-1.5 w-1.5 rounded-full bg-brand-mint" /> : null}
            </span>
          </div>
        ) : <div key={cell.key} aria-hidden="true" />)}
      </div>
    </section>
  );
}

function DateDetails({ event }: { event: PublicScheduleEvent }) {
  if (event.days.length) {
    return (
      <div className="space-y-1">
        {event.days.map((day) => (
          <p key={`${day.date}-${day.startTime || ""}-${day.endTime || ""}`} className="flex items-start gap-2 text-sm font-bold text-gray-600">
            <Clock3 className="mt-0.5 shrink-0 text-penguin-pink-dark" size={16} />
            <span>{formatDate(day.date)}{day.startTime || day.endTime ? `　${[day.startTime, day.endTime].filter(Boolean).join("－")}` : ""}</span>
          </p>
        ))}
      </div>
    );
  }
  if (!event.startDate && !event.endDate) return null;
  const dateText = event.startDate && event.endDate && event.startDate !== event.endDate
    ? `${formatDate(event.startDate)}－${formatDate(event.endDate)}`
    : formatDate(event.startDate || event.endDate || "");
  return <p className="flex items-start gap-2 text-sm font-bold text-gray-600"><Clock3 className="mt-0.5 shrink-0 text-penguin-pink-dark" size={16} /><span>{dateText}</span></p>;
}

function EventCard({ event }: { event: PublicScheduleEvent }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-penguin-peach bg-penguin-pink-light/35">
      {event.imageUrl ? <img src={event.imageUrl} alt="" className="aspect-[16/8] w-full object-cover" loading="lazy" /> : null}
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-black text-penguin-gray">{event.title}</h3>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${event.status === "ongoing" ? "bg-penguin-pink text-white" : event.status === "upcoming" ? "bg-white text-penguin-pink-dark" : "bg-gray-100 text-gray-500"}`}>{STATUS_LABELS[event.status]}</span>
        </div>
        <DateDetails event={event} />
        {event.location ? <p className="flex items-start gap-2 text-sm font-bold text-gray-600"><MapPin className="mt-0.5 shrink-0 text-penguin-pink-dark" size={16} /><span>{event.location}</span></p> : null}
      </div>
    </article>
  );
}

function EventSection({ title, emptyText, events, type }: { title: string; emptyText: string; events: PublicScheduleEvent[]; type: "connection" | "stall" }) {
  const Icon = type === "connection" ? Radio : Store;
  return (
    <section className="rounded-[28px] border-2 border-penguin-peach bg-white p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-penguin-pink-light text-penguin-pink-dark"><Icon size={20} /></span>
        <h2 className="text-xl font-black text-penguin-gray">{title}</h2>
      </div>
      {events.length ? <div className="mt-5 space-y-4">{events.map((event) => <EventCard key={`${event.type}-${event.id}`} event={event} />)}</div> : (
        <div className="mt-5 rounded-2xl bg-penguin-pink-light/45 px-4 py-6 text-center text-sm font-bold text-gray-500">{emptyText}</div>
      )}
    </section>
  );
}

export function LiveMarketInfo({ connections, stalls }: LiveMarketInfoProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-black text-penguin-gray sm:text-4xl">代購 / 市集</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-gray-500 sm:text-base">查看近期代購連線與市集出攤日期，行程更新會同步顯示在這裡。</p>
      </div>
      <div className="mt-7 w-full max-w-sm"><Calendar connections={connections} stalls={stalls} /></div>
      <div className="mt-7 grid items-start gap-6 lg:grid-cols-2">
        <EventSection title="代購連線" emptyText="目前沒有進行中的代購連線" events={connections} type="connection" />
        <EventSection title="市集出攤" emptyText="目前沒有近期市集活動" events={stalls} type="stall" />
      </div>
    </main>
  );
}
