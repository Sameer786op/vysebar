// Clocks: digital, flip, seven-segment, analog, other cities and the date.
import { AnimatePresence, motion } from "motion/react";
import { MONTHS, WEEKDAYS, time, tzTime } from "../lib/format";
import { useNow, useSettings, useTopic } from "../lib/state";
import { WeatherIcon } from "../components/icons";
import type { TileProps, WidgetDef } from "./types";
import { CalendarCard } from "./calendar";

type Weather = { current: { temp: number; code: number; day: boolean }; daily: { date: string; max: number; min: number; code: number }[]; city: string } | { error: string };
const hasWeather = (w: Weather | undefined): w is Exclude<Weather, { error: string }> => !!w && !("error" in w);

function ClockTile() {
  const s = useSettings();
  const now = useNow(1000);
  const t = time(now, s.clock24, true);
  const d = new Date(now);
  return (
    <div className="flex h-full flex-col justify-center px-3.5 leading-none">
      <div className="flex items-baseline gap-1">
        <span className="tabular text-[22px] font-semibold tracking-tight">{t.hm}</span>
        {s.clockSeconds && <span className="tabular text-[13px] font-medium" style={{ color: "var(--fg2)" }}>{t.s}</span>}
        {t.ampm && <span className="text-[11px] font-semibold" style={{ color: "var(--fg2)" }}>{t.ampm}</span>}
      </div>
      <div className="mt-1 text-[11px] font-medium" style={{ color: "var(--fg2)" }}>
        {WEEKDAYS[d.getDay()].slice(0, 3)}, {MONTHS[d.getMonth()].slice(0, 3)} {d.getDate()}
      </div>
    </div>
  );
}

/** weekday and date on a red block, then the time and temperature */
function DateClockTile() {
  const s = useSettings();
  const now = useNow(1000);
  const w = useTopic<Weather>("weather");
  const t = time(now, s.clock24, s.clockSeconds);
  const d = new Date(now);
  return (
    <div className="flex h-full items-center gap-3 pl-3 pr-3.5">
      <div className="flex flex-col justify-center leading-none">
        <span className="text-[8.5px] font-bold tracking-[0.09em] text-[#ff453a]">{WEEKDAYS[d.getDay()].toUpperCase()}</span>
        <span className="mt-[5px] text-[14px] font-semibold">{MONTHS[d.getMonth()].slice(0, 3)} {d.getDate()}</span>
      </div>
      <span className="h-[24px] w-px shrink-0" style={{ background: "var(--line)" }} />
      <div className="flex flex-col justify-center leading-none">
        <div className="flex items-baseline gap-1">
          <span className="tabular text-[18px] font-semibold tracking-tight">{t.hm}</span>
          {t.s && <span className="tabular text-[11px]" style={{ color: "var(--fg2)" }}>{t.s}</span>}
          {t.ampm && <span className="text-[10px] font-semibold" style={{ color: "var(--fg2)" }}>{t.ampm}</span>}
        </div>
        {hasWeather(w) && (
          <div className="mt-1 flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--fg2)" }}>
            <WeatherIcon code={w.current.code} day={w.current.day} size={12} /> {w.current.temp}°
          </div>
        )}
      </div>
    </div>
  );
}

function FlipDigit({ d }: { d: string }) {
  return (
    <div className="relative h-[34px] w-[24px] overflow-hidden rounded-[6px] text-white" style={{ background: "linear-gradient(#2c2c2e 50%, #232325 50%)", perspective: 120 }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={d}
          className="tabular absolute inset-0 grid place-items-center text-[22px] font-bold"
          initial={{ rotateX: -90, opacity: 0.4 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: 90, opacity: 0 }}
          transition={{ duration: 0.38, ease: [0.3, 0.7, 0.2, 1] }}
          style={{ transformOrigin: "50% 50%" }}
        >
          {d}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/60" />
    </div>
  );
}

function FlipClockTile() {
  const s = useSettings();
  const now = useNow(1000);
  const t = time(now, s.clock24);
  const digits = t.hm.padStart(5, "0").replace(":", "");
  return (
    <div className="flex h-full items-center gap-[3px] px-2">
      <FlipDigit d={digits[0]} />
      <FlipDigit d={digits[1]} />
      <div className="w-1" />
      <FlipDigit d={digits[2]} />
      <FlipDigit d={digits[3]} />
      {t.ampm && <span className="ml-1 self-end pb-1.5 text-[9px] font-bold" style={{ color: "var(--fg2)" }}>{t.ampm}</span>}
    </div>
  );
}

export function AnalogFace({ h, m, s, size = 38, dark = false, minimal = false, seconds = true }: { h: number; m: number; s: number; size?: number; dark?: boolean; minimal?: boolean; seconds?: boolean }) {
  const face = dark ? "#1c1c1e" : "#f5f5f7";
  const ink = dark ? "#f5f5f7" : "#1c1c1e";
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill={face} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const long = i % 3 === 0;
        if (minimal && !long) return null;
        return <line key={i} x1={50 + Math.sin(a) * (long ? 36 : 39)} y1={50 - Math.cos(a) * (long ? 36 : 39)} x2={50 + Math.sin(a) * 43} y2={50 - Math.cos(a) * 43} stroke={ink} strokeOpacity={long ? 0.9 : 0.4} strokeWidth={long ? 4 : 2.5} strokeLinecap="round" />;
      })}
      {hand(((h % 12) + m / 60) * 30, 24, 6, ink)}
      {hand((m + s / 60) * 6, 35, 4.5, ink)}
      {seconds && hand(s * 6, 38, 2, "#ff9f0a")}
      <circle cx="50" cy="50" r="3.6" fill={seconds ? "#ff9f0a" : ink} />
    </svg>
  );
}

function analogTile(dark: boolean, minimal = false) {
  return function Analog() {
    const now = useNow(1000);
    const d = new Date(now);
    return (
      <div className="grid h-full place-items-center px-[5px]">
        <AnalogFace h={d.getHours()} m={d.getMinutes()} s={d.getSeconds()} dark={dark} minimal={minimal} size={40} />
      </div>
    );
  };
}

const short = (name: string) => name.replace(/[^A-Za-z ]/g, "").split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase() || name.slice(0, 3).toUpperCase();

function WorldClocksTile() {
  const s = useSettings();
  const now = useNow(1000);
  return (
    <div className="flex h-full items-center gap-2 px-2.5">
      {s.worldClocks.slice(0, 3).map((c) => {
        const t = tzTime(now, c.tz, true);
        return (
          <div key={c.tz} className="flex flex-col items-center gap-[2px]">
            <AnalogFace h={t.h} m={t.m} s={t.s} size={30} dark={t.h < 6 || t.h >= 19} seconds={false} />
            <span className="text-[8px] font-bold tracking-wide" style={{ color: "var(--fg2)" }}>{c.name.length <= 3 ? c.name.toUpperCase() : short(c.name)}</span>
          </div>
        );
      })}
    </div>
  );
}

function WorldClockListTile() {
  const s = useSettings();
  const now = useNow(1000);
  return (
    <div className="flex h-full flex-col justify-center gap-[1px] px-3 text-[10.5px] leading-[13px]">
      {s.worldClocks.slice(0, 3).map((c) => {
        const t = tzTime(now, c.tz, s.clock24);
        return (
          <div key={c.tz} className="flex items-center gap-2">
            <span className="w-[62px] truncate font-medium" style={{ color: "var(--fg2)" }}>{c.name}</span>
            <span className="tabular font-semibold">{t.hm}{t.ampm && <span className="ml-0.5 text-[8px]">{t.ampm}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

function WorldTimeTile() {
  const s = useSettings();
  const now = useNow(1000);
  const c = s.worldClocks[0] ?? { name: "London", tz: "Europe/London" };
  const t = tzTime(now, c.tz, s.clock24);
  const off = t.offsetH;
  return (
    <div className="flex h-full flex-col justify-center px-3.5 leading-none">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold" style={{ color: "var(--fg2)" }}>
        {c.name} <span style={{ color: "var(--fg3)" }}>{off === 0 ? "same time" : `${off > 0 ? "+" : ""}${Number.isInteger(off) ? off : off.toFixed(1)}h`}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tabular text-[20px] font-semibold">{t.hm}</span>
        {t.ampm && <span className="text-[10px] font-semibold" style={{ color: "var(--fg2)" }}>{t.ampm}</span>}
      </div>
    </div>
  );
}

function DateTile() {
  const now = useNow(60_000);
  const d = new Date(now);
  return (
    <div className="flex h-full flex-col justify-center px-3.5 leading-none">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#ff453a" }}>{WEEKDAYS[d.getDay()]}</span>
      <span className="mt-1.5 text-[17px] font-semibold">{MONTHS[d.getMonth()]} {d.getDate()}</span>
    </div>
  );
}

function DayNumberTile() {
  const now = useNow(60_000);
  const d = new Date(now);
  return (
    <div className="grid h-full place-items-center px-[5px]">
      <div className="flex h-[38px] w-[38px] flex-col overflow-hidden rounded-[10px] bg-white text-center leading-none shadow-sm">
        <div className="bg-[#ff3b30] py-[2px] text-[8px] font-bold tracking-wider text-white">{WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()}</div>
        <div className="grid flex-1 place-items-center text-[19px] font-semibold text-[#1c1c1e]">{d.getDate()}</div>
      </div>
    </div>
  );
}

// seven segments: a b c d e f g
const SEG: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
function Seg({ d, color }: { d: string; color: string }) {
  const on = SEG[d] ?? "";
  const seg = (k: string, x: number, y: number, w: number, h: number) => <rect key={k} x={x} y={y} width={w} height={h} rx={1.2} fill={color} opacity={on.includes(k) ? 1 : 0.1} />;
  return (
    <svg width="14" height="24" viewBox="0 0 14 24">
      {seg("a", 2.5, 0, 9, 2.4)}
      {seg("b", 11.6, 2, 2.4, 9)}
      {seg("c", 11.6, 13, 2.4, 9)}
      {seg("d", 2.5, 21.6, 9, 2.4)}
      {seg("e", 0, 13, 2.4, 9)}
      {seg("f", 0, 2, 2.4, 9)}
      {seg("g", 2.5, 10.8, 9, 2.4)}
    </svg>
  );
}

function SegmentClockTile() {
  const s = useSettings();
  const now = useNow(1000);
  const t = time(now, s.clock24);
  const d = new Date(now);
  const digits = t.hm.padStart(5, "0");
  const color = "#ff9f0a";
  return (
    <div className="flex h-full flex-col justify-center px-3 leading-none">
      <div className="mb-[3px] text-[8px] font-bold tracking-widest" style={{ color: "var(--fg2)" }}>
        {WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()} {d.getDate()}
      </div>
      <div className="flex items-center gap-[3px]">
        <Seg d={digits[0]} color={color} />
        <Seg d={digits[1]} color={color} />
        <div className="flex flex-col gap-[5px] px-[1px]">
          <span className="h-[3px] w-[3px] rounded-full" style={{ background: color, opacity: d.getSeconds() % 2 ? 1 : 0.2 }} />
          <span className="h-[3px] w-[3px] rounded-full" style={{ background: color, opacity: d.getSeconds() % 2 ? 1 : 0.2 }} />
        </div>
        <Seg d={digits[3]} color={color} />
        <Seg d={digits[4]} color={color} />
      </div>
    </div>
  );
}

function ClockWeatherTile() {
  const s = useSettings();
  const now = useNow(1000);
  const w = useTopic<Weather>("weather");
  const t = time(now, s.clock24);
  const d = new Date(now);
  return (
    <div className="flex h-full items-center gap-[3px] p-[4px] text-white">
      <div className="flex h-full flex-col justify-center rounded-l-[11px] rounded-r-[4px] px-2 leading-none" style={{ background: "#ff9f0a" }}>
        <span className="tabular text-[14px] font-bold">{t.hm}</span>
        {t.ampm && <span className="mt-0.5 text-[8px] font-bold opacity-80">{t.ampm}</span>}
      </div>
      <div className="flex h-full flex-col justify-center rounded-[4px] px-2 leading-none" style={{ background: "#0a84ff" }}>
        <span className="text-[8px] font-bold opacity-80">{WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()}</span>
        <span className="text-[14px] font-bold">{d.getDate()}</span>
      </div>
      <div className="flex h-full items-center rounded-l-[4px] rounded-r-[11px] px-2 text-[14px] font-bold" style={{ background: "#30d158" }}>
        {hasWeather(w) ? `${w.current.temp}°` : "--"}
      </div>
    </div>
  );
}

function SevenDaysTile() {
  const now = useNow(60_000);
  const w = useTopic<Weather>("weather");
  const d = new Date(now);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return (
    <div className="flex h-full items-center gap-[3px] px-2.5">
      {Array.from({ length: 7 }, (_, i) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        const today = day.toDateString() === d.toDateString();
        return (
          <div key={i} className="flex w-[22px] flex-col items-center gap-[3px] rounded-[7px] py-[3px] leading-none" style={{ background: today ? "var(--accent)" : "transparent", color: today ? "white" : "var(--fg)" }}>
            <span className="text-[8px] font-bold opacity-70">{"MTWTFSS"[i]}</span>
            <span className="text-[12px] font-semibold">{day.getDate()}</span>
            {today && hasWeather(w) ? <span className="text-[8px] font-bold">{w.current.temp}°</span> : <span className="text-[8px] opacity-0">0</span>}
          </div>
        );
      })}
    </div>
  );
}

const clockCard = { Card: CalendarCard, cardWidth: 620, cardFocus: true } as const;

export const clockWidgets: WidgetDef[] = [
  { type: "clock", name: "Clock", category: "Clocks", description: "Large, readable time with its seconds and the date.", Tile: ClockTile, ...clockCard },
  { type: "dateClock", name: "Today", category: "Clocks", description: "Weekday, date, time and weather in a single tile.", Tile: DateClockTile, ...clockCard },
  { type: "flipClock", name: "Flip Clock", category: "Clocks", description: "Split-flap digits that turn over every minute.", Tile: FlipClockTile, ...clockCard },
  { type: "segmentClock", name: "Segment Clock", category: "Clocks", description: "The time as a seven-segment display, under the weekday and date.", Tile: SegmentClockTile, ...clockCard },
  { type: "analogClassic", name: "Analog Classic", category: "Clocks", description: "A white analog face with a sweeping second hand.", Tile: analogTile(false), ...clockCard },
  { type: "analogDark", name: "Analog Classic Dark", category: "Clocks", description: "The same classic face, in black.", Tile: analogTile(true), ...clockCard },
  { type: "analogMinimal", name: "Analog Minimal", category: "Clocks", description: "Hands and hour ticks on a dark face, nothing else.", Tile: analogTile(true, true), ...clockCard },
  { type: "worldClocks", name: "World Clocks", category: "Clocks", description: "Three small analog faces for the cities you work with.", Tile: WorldClocksTile, ...clockCard },
  { type: "worldClockList", name: "World Clock", category: "Clocks", description: "Three cities in a list, each with its own time.", Tile: WorldClockListTile, ...clockCard },
  { type: "worldTime", name: "World Time", category: "Clocks", description: "One more city in big digits, with its offset.", Tile: WorldTimeTile, ...clockCard },
  { type: "date", name: "Date", category: "Clocks", description: "The full date, set large.", Tile: DateTile, ...clockCard },
  { type: "dayNumber", name: "Day Number", category: "Clocks", description: "Today's date as a calendar page.", Tile: DayNumberTile, ...clockCard },
  { type: "clockWeather", name: "Clock & Weather", category: "Clocks", description: "Time, date and temperature as three colour blocks.", Tile: ClockWeatherTile, ...clockCard },
  { type: "sevenDays", name: "7 Days", category: "Clocks", description: "This week as a strip of days, with today's temperature.", Tile: SevenDaysTile, ...clockCard },
];

export type { TileProps };
