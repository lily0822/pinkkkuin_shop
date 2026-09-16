"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ImageIcon, MapPin, Radio, Store, X } from "lucide-react";
import type { PublicScheduleEvent, ScheduleEventStatus } from "@/lib/storefront-schedules";

type LiveMarketInfoProps = {
  connections: PublicScheduleEvent[];
  stalls: PublicScheduleEvent[];
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const STATUS_LABELS: Record<Exclude<ScheduleEventStatus, "upcoming">, string> = {
  ongoing: "進行中",
  ended: "已結束",
};

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
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
  const [initialYear, initialMonth] = focusDate.split("-").map(Number);
  const [{ year, month }, setVisibleMonth] = useState({ year: initialYear, month: initialMonth });
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

  function changeMonth(offset: number) {
    setVisibleMonth((current) => {
      const next = new Date(Date.UTC(current.year, current.month - 1 + offset, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
  }

  return (
    <section className="rounded-[22px] border border-penguin-peach bg-white p-3">
      <div className="flex flex-col items-stretch gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-penguin-pink-light text-penguin-pink-dark"><CalendarDays size={17} /></span>
            <h2 className="text-sm font-black text-penguin-gray">{year} 年 {month} 月</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="上一月" onClick={() => changeMonth(-1)} className="grid h-8 w-8 place-items-center rounded-xl border border-penguin-peach bg-white text-penguin-pink-dark transition-colors hover:bg-penguin-pink-light"><ChevronLeft size={16} /></button>
            <button type="button" aria-label="下一月" onClick={() => changeMonth(1)} className="grid h-8 w-8 place-items-center rounded-xl border border-penguin-peach bg-white text-penguin-pink-dark transition-colors hover:bg-penguin-pink-light"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center sm:gap-1">
        {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1 text-xs font-black text-gray-400">{weekday}</div>)}
        {cells.map((cell) => {
          if (!cell.day) return <div key={cell.key} aria-hidden="true" />;
          const hasConnection = connectionDates.has(cell.key);
          const hasStall = stallDates.has(cell.key);
          const activityStyle = hasConnection && hasStall
            ? "ring-1 ring-inset ring-penguin-pink-dark/35"
            : hasConnection
              ? "ring-1 ring-inset ring-penguin-pink-dark/35"
              : hasStall
                ? "ring-1 ring-inset ring-emerald-600/25"
                : "";
          const activityBackground = hasConnection && hasStall
            ? { backgroundImage: "linear-gradient(135deg, #ffebf1 0%, #ffebf1 49%, #bfe2ce 51%, #bfe2ce 100%)" }
            : hasConnection
              ? { backgroundColor: "#ffebf1" }
              : hasStall
                ? { backgroundColor: "#bfe2ce" }
                : undefined;
          return (
            <div key={cell.key} style={activityBackground} className={`relative grid aspect-square min-w-0 place-items-center rounded-lg text-xs font-bold text-penguin-gray ${activityStyle}`}>
              <span className={`relative z-10 grid h-6 w-6 place-items-center ${cell.key === today ? "rounded-full bg-penguin-yellow text-penguin-gray" : ""}`}>{cell.day}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-3 text-[11px] font-bold text-gray-500">
        <span className="inline-flex items-center gap-1.5"><i style={{ backgroundColor: "#ffebf1" }} className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ring-penguin-pink-dark/35" />代購連線</span>
        <span className="inline-flex items-center gap-1.5"><i style={{ backgroundColor: "#bfe2ce" }} className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ring-emerald-600/25" />市集出攤</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-penguin-yellow" />今天</span>
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
            <span>{formatDate(day.date)}{day.startTime || day.endTime ? ` ${[day.startTime, day.endTime].filter(Boolean).join(" ~ ")}` : ""}</span>
          </p>
        ))}
      </div>
    );
  }
  if (!event.startDate && !event.endDate) return null;
  const dateText = event.startDate && event.endDate && event.startDate !== event.endDate
    ? `${formatDate(event.startDate)} ~ ${formatDate(event.endDate)}`
    : formatDate(event.startDate || event.endDate || "");
  return <p className="flex items-start gap-2 text-sm font-bold text-gray-600"><Clock3 className="mt-0.5 shrink-0 text-penguin-pink-dark" size={16} /><span>{dateText}</span></p>;
}

function EventCard({ event, onOpenImage }: { event: PublicScheduleEvent; onOpenImage: (url: string, alt: string) => void }) {
  return (
    <article className="flex flex-col items-center gap-3 p-3 sm:min-h-36 sm:flex-row sm:items-start sm:gap-4">
      {event.imageUrl ? (
        <button type="button" onClick={() => onOpenImage(event.imageUrl!, event.title)} aria-label={`放大查看${event.title}圖片`} className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-penguin-pink-light/45 text-penguin-pink-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-penguin-pink-dark">
          <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover transition-transform duration-200 hover:scale-105" loading="lazy" />
        </button>
      ) : (
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-penguin-pink-light/45 text-penguin-pink-dark"><ImageIcon size={24} /></div>
      )}
      <div className="min-w-0 w-full flex-1 space-y-2 sm:py-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-black text-penguin-gray">{event.title}</h3>
          {event.status !== "upcoming" ? <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${event.status === "ongoing" ? "bg-penguin-pink text-white" : "bg-gray-100 text-gray-500"}`}>{STATUS_LABELS[event.status]}</span> : null}
        </div>
        <DateDetails event={event} />
        {event.location ? <p className="flex items-start gap-2 text-sm font-bold text-gray-600"><MapPin className="mt-0.5 shrink-0 text-penguin-pink-dark" size={16} /><span>{event.location}</span></p> : null}
      </div>
    </article>
  );
}

function EventSection({ title, emptyText, events, type, onOpenImage }: { title: string; emptyText: string; events: PublicScheduleEvent[]; type: "connection" | "stall"; onOpenImage: (url: string, alt: string) => void }) {
  const Icon = type === "connection" ? Radio : Store;
  return (
    <section>
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${type === "connection" ? "bg-penguin-pink-light text-penguin-pink-dark" : "bg-brand-mint/45 text-emerald-700"}`}><Icon size={18} /></span>
        <h2 className="text-lg font-black text-penguin-gray">{title}</h2>
      </div>
      {events.length ? <div className="mt-3 overflow-hidden rounded-2xl border border-penguin-peach bg-white">{events.map((event, index) => <div key={`${event.type}-${event.id}`} className={index ? "border-t border-dashed border-penguin-peach" : ""}><EventCard event={event} onOpenImage={onOpenImage} /></div>)}</div> : (
        <div className={`mt-3 flex min-h-20 items-center rounded-2xl px-4 py-4 text-sm font-bold text-gray-500 ${type === "connection" ? "bg-penguin-pink-light/45" : "bg-brand-mint/25"}`}>{emptyText}</div>
      )}
    </section>
  );
}

export function LiveMarketInfo({ connections, stalls }: LiveMarketInfoProps) {
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setLightbox(null); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [lightbox]);

  const openImage = (url: string, alt: string) => setLightbox({ url, alt });

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-black text-penguin-gray sm:text-3xl">代購 / 市集</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-gray-500">查看近期代購連線與市集出攤日期，行程更新會同步顯示在這裡。</p>
      </div>
      <div className="mt-6 grid items-start gap-7 lg:grid-cols-[minmax(0,352px)_minmax(0,1fr)] lg:gap-10 xl:gap-12">
        <div className="w-full max-w-[352px] justify-self-center lg:justify-self-start"><Calendar connections={connections} stalls={stalls} /></div>
        <div className="min-w-0 space-y-7">
          <EventSection title="代購連線" emptyText="目前沒有進行中的代購連線" events={connections} type="connection" onOpenImage={openImage} />
          <EventSection title="市集出攤" emptyText="目前沒有近期市集活動" events={stalls} type="stall" onOpenImage={openImage} />
        </div>
      </div>
      {lightbox ? (
        <div role="dialog" aria-modal="true" aria-label={`${lightbox.alt}大圖預覽`} onClick={() => setLightbox(null)} className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 sm:p-8">
          <div onClick={(event) => event.stopPropagation()} className="relative flex max-h-full max-w-5xl items-center justify-center">
            <img src={lightbox.url} alt={lightbox.alt} className="max-h-[85vh] max-w-full rounded-2xl bg-white object-contain" />
            <button type="button" aria-label="關閉圖片預覽" onClick={() => setLightbox(null)} className="absolute -right-2 -top-2 grid h-10 w-10 place-items-center rounded-full bg-white text-penguin-gray shadow-sm"><X size={20} /></button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
