// One calendar for everything with a date: your events, subscribed Google/Outlook/iCloud
// calendars, to-dos that are due and when your Claude session resets.
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { CalEvent, GoogleProfile } from "@shared/types";
import { MONTHS, WEEKDAYS, clock, relative, sameDay, startOfDay } from "../lib/format";
import { setData, uid, useData, useNow, useSettings, useTopic } from "../lib/state";
import type { CardProps, WidgetDef } from "./types";

export function useAllEvents(): CalEvent[] {
  const data = useData();
  const ics = useTopic<{ events: CalEvent[] }>("calendars");
  const claude = useTopic<{ active: boolean; resetsAt: number | null }>("claude");
  return useMemo(() => {
    const out: CalEvent[] = [...data.events, ...(ics?.events ?? [])];
    for (const t of data.todos) {
      if (t.due && !t.done) out.push({ id: "todo:" + t.id, title: t.text, start: t.due, end: t.due, source: "To-do", color: "#30d158", kind: "due" });
    }
    if (claude?.active && claude.resetsAt) {
      out.push({ id: "claude-reset", title: "Claude session resets", start: claude.resetsAt, end: claude.resetsAt, source: "Claude", color: "#d97757", kind: "limit" });
    }
    return out.sort((a, b) => a.start - b.start);
  }, [data.events, data.todos, ics, claude]);
}

export function nextEvent(events: CalEvent[], now: number): CalEvent | undefined {
  return events.find((e) => !e.allDay && e.end > now && e.kind !== "limit") ?? events.find((e) => e.allDay && sameDay(e.start, now));
}

function CalendarTile() {
  const s = useSettings();
  const now = useNow(30_000);
  const events = useAllEvents();
  const d = new Date(now);
  const next = nextEvent(events, now);
  return (
    <div className="flex h-full items-center gap-2.5 pl-[6px] pr-3.5" style={{ maxWidth: 220 }}>
      <div className="flex h-[32px] w-[32px] shrink-0 flex-col items-center justify-center rounded-[9px] leading-none" style={{ background: "var(--chip)" }}>
        <span className="text-[7.5px] font-bold tracking-wider text-[#ff453a]">{WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()}</span>
        <span className="mt-[2px] text-[15px] font-semibold">{d.getDate()}</span>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-[5px] leading-none">
        {next ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="h-[11px] w-[3px] shrink-0 rounded-full" style={{ background: next.color }} />
              <span className="truncate text-[12.5px] font-semibold">{next.title}</span>
            </div>
            <span className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>
              {next.allDay ? "All day" : `${clock(next.start, s.clock24)} · ${next.start > now ? relative(next.start - now) : "now"}`}
            </span>
          </>
        ) : (
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--fg2)" }} title="Click to plan your day">No events</span>
        )}
      </div>
    </div>
  );
}

const kindColor = { event: "#0a84ff", renewal: "#bf5af2", payout: "#30d158", limit: "#d97757", due: "#ff9f0a" };

function greeting(h: number): string {
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

/** signed in with Google: a hello, with your photo, above the calendar */
function Hello({ p, now }: { p: GoogleProfile; now: number }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5">
      {p.photo ? <img src={p.photo} alt="" className="h-[30px] w-[30px] rounded-full object-cover" /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--accent)] text-[13px] font-semibold text-white">{p.givenName.slice(0, 1)}</span>}
      <div className="text-[15px] font-semibold">
        {greeting(new Date(now).getHours())}, {p.givenName}
      </div>
    </div>
  );
}

export function CalendarCard(_: CardProps) {
  const s = useSettings();
  const profile = useTopic<GoogleProfile | null>("profile");
  const data = useData();
  const now = useNow(30_000);
  const events = useAllEvents();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  });

  const first = (month.getDay() + 6) % 7; // weeks start on Monday
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + daysIn) / 7) * 7 }, (_, i) => {
    const n = i - first + 1;
    return n >= 1 && n <= daysIn ? new Date(month.getFullYear(), month.getMonth(), n).getTime() : null;
  });
  const byDay = (t: number) => events.filter((e) => sameDay(e.start, t) || (e.allDay && e.start <= t && e.end > t));
  const dayEvents = byDay(day);

  const add = () => {
    if (!title.trim()) return;
    const [h, m] = at.split(":").map(Number);
    const start = new Date(day);
    start.setHours(h || 0, m || 0, 0, 0);
    const ev: CalEvent = { id: uid(), title: title.trim(), start: start.getTime(), end: start.getTime() + 3600_000, source: "VyseBar", color: s.accent, kind: "event" };
    setData({ events: [...data.events, ev] });
    setTitle("");
    setAdding(false);
  };

  return (
    <div>
      {profile && <Hello p={profile} now={now} />}
      <div className="flex gap-4">
      <div className="w-[300px] shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[18px] font-semibold">
            {MONTHS[month.getMonth()]}, <span style={{ color: "var(--fg2)" }}>{month.getFullYear()}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="rounded-full px-2.5 py-1 text-[12px] font-medium"
              style={{ color: "var(--accent)" }}
              onClick={() => {
                const d = new Date();
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                setDay(startOfDay(d));
              }}
            >
              Today
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--chip)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronLeft size={16} />
            </button>
            <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--chip)]" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold" style={{ color: "var(--fg3)" }}>
          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <motion.div key={month.getTime()} className="grid grid-cols-7 gap-1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
          {cells.map((t, i) => {
            if (t === null) return <div key={i} />;
            const evs = byDay(t);
            const isToday = sameDay(t, now);
            const sel = t === day;
            return (
              <button
                key={i}
                onClick={() => setDay(t)}
                className="relative flex h-[38px] flex-col items-center justify-center rounded-[10px] text-[13px] transition-colors"
                style={{
                  background: sel ? "var(--accent)" : "var(--chip)",
                  color: sel ? "white" : isToday ? "var(--accent)" : "var(--fg)",
                  fontWeight: isToday || sel ? 700 : 500,
                }}
              >
                {new Date(t).getDate()}
                {evs.length > 0 && (
                  <div className="absolute bottom-[4px] flex gap-[2px]">
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className="h-[4px] w-[4px] rounded-full" style={{ background: sel ? "white" : e.color || kindColor[e.kind ?? "event"] }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </motion.div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--fg2)" }}>
          {(["event", "due", "limit"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: kindColor[k] }} />
              {{ event: "Events", due: "To-dos due", limit: "Limit resets" }[k]}
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-h-[330px] min-w-0 flex-1 flex-col rounded-[16px] p-3" style={{ background: "var(--chip)" }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-semibold">{sameDay(day, now) ? "Today" : new Date(day).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
          <span className="text-[11px]" style={{ color: "var(--fg2)" }}>
            {dayEvents.length} {dayEvents.length === 1 ? "item" : "items"}
          </span>
        </div>
        <div className="thin-scroll flex-1 space-y-1.5 overflow-y-auto">
          <AnimatePresence initial={false}>
            {dayEvents.map((e) => (
              <motion.div key={e.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="group flex items-start gap-2.5 rounded-[10px] px-1 py-1.5">
                <span className="w-[54px] shrink-0 pt-[1px] text-[11px] tabular" style={{ color: "var(--fg2)" }}>
                  {e.allDay ? "All day" : clock(e.start, s.clock24)}
                </span>
                <span className="mt-[2px] h-[15px] w-[3px] shrink-0 rounded-full" style={{ background: e.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{e.title}</div>
                  <div className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>
                    {e.source}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                </div>
                {e.source === "VyseBar" && (
                  <button className="opacity-0 transition-opacity group-hover:opacity-70" onClick={() => setData({ events: data.events.filter((x) => x.id !== e.id) })}>
                    <Trash2 size={13} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {dayEvents.length === 0 && (
            <div className="pt-8 text-center text-[12px]" style={{ color: "var(--fg3)" }}>
              Nothing planned
            </div>
          )}
        </div>
        {adding ? (
          <div className="mt-2 flex items-center gap-1.5 rounded-full p-1" style={{ background: "var(--chip)" }}>
            <input type="time" value={at} onChange={(e) => setAt(e.target.value)} className="w-[86px] rounded-full bg-transparent px-2 text-[12px] outline-none" />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="New event"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--fg3)]"
            />
            <button className="grid h-6 w-6 place-items-center rounded-full" onClick={() => setAdding(false)}>
              <X size={13} />
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-2 flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-medium hover:bg-[var(--chip-hover)]" style={{ background: "var(--chip)" }}>
            <Plus size={13} /> New event
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

export const calendarWidgets: WidgetDef[] = [
  { type: "calendar", name: "Calendar", category: "Productivity", description: "Your next event and how soon it starts, with every calendar in one place.", Tile: CalendarTile, Card: CalendarCard, cardWidth: 620, cardFocus: true },
];
