// Weather from Open-Meteo for the city in Settings: now, the next hours, the week, the sun.
import { Droplets, MapPin, Sunrise, Sunset, Thermometer, Umbrella, Wind } from "lucide-react";
import { useNow, useSettings, useTopic } from "../lib/state";
import { WeatherIcon, skyGradient, skyLabel } from "../components/icons";
import { Empty } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";

interface Hour { time: string; temp: number; code: number; rain: number; day: boolean }
interface Day { date: string; code: number; max: number; min: number; sunrise: string; sunset: string; rain: number; uv: number }
export interface WeatherData {
  city: string;
  units: "c" | "f";
  utcOffset: number;
  current: { temp: number; feels: number; humidity: number; code: number; wind: number; day: boolean; precip: number };
  hourly: Hour[];
  daily: Day[];
  fetchedAt: number;
}
type W = WeatherData | { error: string };

export function useWeather(): { w: WeatherData | null; error: string | null } {
  const w = useTopic<W>("weather");
  if (!w) return { w: null, error: null };
  if ("error" in w) return { w: null, error: w.error };
  return { w, error: null };
}

// Open-Meteo gives the city's wall-clock times without a zone; compare them as if UTC
const cityMs = (s: string) => Date.parse(s + "Z");
const cityNow = (w: WeatherData) => Date.now() + w.utcOffset * 1000;
const hourLabel = (s: string, h24: boolean) => {
  const h = Number(s.slice(11, 13));
  return h24 ? `${String(h).padStart(2, "0")}` : `${h % 12 || 12}${h < 12 ? "AM" : "PM"}`;
};
const hm = (s: string, h24: boolean) => {
  const h = Number(s.slice(11, 13));
  const m = s.slice(14, 16);
  return h24 ? `${String(h).padStart(2, "0")}:${m}` : `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};
const dayName = (date: string, i: number) => (i === 0 ? "Today" : new Date(date + "T12:00").toLocaleDateString([], { weekday: "short" }));

function Loading({ error }: { error: string | null }) {
  return (
    <div className="flex h-full items-center gap-2 px-3.5 text-[11.5px]" style={{ color: "var(--fg2)" }}>
      <WeatherIcon code={2} size={22} />
      <span className="max-w-[140px] truncate">{error ?? "Loading weather..."}</span>
    </div>
  );
}

// ---------- tiles ----------

function WeatherTile() {
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  const today = w.daily[0];
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3.5">
      <WeatherIcon code={w.current.code} day={w.current.day} size={30} />
      <div className="flex flex-col leading-none">
        <span className="text-[19px] font-semibold">{w.current.temp}°</span>
        <span className="mt-[3px] text-[10px] font-medium" style={{ color: "var(--fg2)" }}>H:{today?.max}° L:{today?.min}°</span>
      </div>
    </div>
  );
}

function WeatherDetailsTile() {
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  return (
    <div className="flex h-full items-center gap-3 pl-2.5 pr-3.5">
      <WeatherIcon code={w.current.code} day={w.current.day} size={28} />
      <div className="flex flex-col leading-none">
        <span className="text-[17px] font-semibold">{w.current.temp}°</span>
        <span className="mt-[3px] max-w-[90px] truncate text-[10px] font-medium" style={{ color: "var(--fg2)" }}>{skyLabel(w.current.code)}</span>
      </div>
      <div className="flex flex-col gap-[3px] text-[10.5px] font-medium leading-none" style={{ color: "var(--fg2)" }}>
        <span className="flex items-center gap-1"><Thermometer size={10} /> Feels {w.current.feels}°</span>
        <span className="flex items-center gap-1"><Droplets size={10} /> {w.current.humidity}%</span>
        <span className="flex items-center gap-1"><Wind size={10} /> {w.current.wind} {w.units === "f" ? "mph" : "km/h"}</span>
      </div>
    </div>
  );
}

function ForecastTile() {
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      {w.daily.slice(0, 5).map((d, i) => (
        <div key={d.date} className="flex flex-col items-center leading-none">
          <span className="text-[9px] font-semibold" style={{ color: i === 0 ? "var(--accent)" : "var(--fg2)" }}>{dayName(d.date, i).slice(0, 3)}</span>
          <WeatherIcon code={d.code} size={17} />
          <span className="text-[10.5px] font-semibold">{d.max}°</span>
        </div>
      ))}
    </div>
  );
}

function TodayForecastTile() {
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  const d = w.daily[0];
  return (
    <div className="flex h-full items-center gap-2.5 pl-2 pr-3.5">
      <div className="grid h-[36px] w-[36px] place-items-center rounded-[11px]" style={{ background: skyGradient(d.code, w.current.day) }}>
        <WeatherIcon code={d.code} size={24} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-semibold">{skyLabel(d.code)}</span>
        <span className="text-[10.5px]" style={{ color: "var(--fg2)" }}>{d.max}° / {d.min}° · <Umbrella size={9} className="inline" /> {d.rain ?? 0}%</span>
      </div>
    </div>
  );
}

function WeatherStatusTile() {
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  return (
    <div className="flex h-full items-center px-1">
      <div className="flex h-[calc(100%-10px)] items-center gap-2 rounded-[11px] px-3 text-white" style={{ background: skyGradient(w.current.code, w.current.day) }}>
        <WeatherIcon code={w.current.code} day={w.current.day} size={22} />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold">{w.current.temp}°</span>
          <span className="mt-[2px] max-w-[90px] truncate text-[9.5px] font-semibold opacity-85">{w.city}</span>
        </div>
      </div>
    </div>
  );
}

function HourlyTile() {
  const s = useSettings();
  const { w, error } = useWeather();
  if (!w) return <Loading error={error} />;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      {w.hourly.slice(0, 6).map((h, i) => (
        <div key={h.time} className="flex flex-col items-center leading-none">
          <span className="text-[9px] font-semibold" style={{ color: "var(--fg2)" }}>{i === 0 ? "Now" : hourLabel(h.time, s.clock24)}</span>
          <WeatherIcon code={h.code} day={h.day} size={17} />
          <span className="text-[10.5px] font-semibold">{h.temp}°</span>
        </div>
      ))}
    </div>
  );
}

function SunArc({ w, width = 120, height = 34 }: { w: WeatherData; width?: number; height?: number }) {
  const d = w.daily[0];
  const rise = cityMs(d.sunrise);
  const set = cityMs(d.sunset);
  const now = cityNow(w);
  const p = Math.max(0, Math.min(1, (now - rise) / (set - rise)));
  const up = now >= rise && now <= set;
  const x = 6 + p * (width - 12);
  const y = height - 4 - Math.sin(p * Math.PI) * (height - 10);
  return (
    <svg width={width} height={height}>
      <path d={`M6 ${height - 4} Q ${width / 2} ${-height + 14} ${width - 6} ${height - 4}`} fill="none" stroke="var(--fg3)" strokeDasharray="2 3" />
      <line x1={0} x2={width} y1={height - 4} y2={height - 4} stroke="var(--line)" />
      <circle cx={x} cy={y} r={5} fill={up ? "#ffd60a" : "var(--fg3)"} style={{ filter: up ? "drop-shadow(0 0 4px #ffd60a)" : undefined }} />
    </svg>
  );
}

function SunriseSunsetTile() {
  const s = useSettings();
  const { w, error } = useWeather();
  useNow(60_000);
  if (!w) return <Loading error={error} />;
  const d = w.daily[0];
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="flex flex-col gap-[3px] text-[10.5px] font-semibold leading-none">
        <span className="flex items-center gap-1"><Sunrise size={11} className="text-[#ff9f0a]" />{hm(d.sunrise, s.clock24)}</span>
        <span className="flex items-center gap-1" style={{ color: "var(--fg2)" }}><Sunset size={11} className="text-[#ff375f]" />{hm(d.sunset, s.clock24)}</span>
      </div>
      <SunArc w={w} width={70} height={30} />
    </div>
  );
}

// ---------- the card ----------

function WeatherCard(_: CardProps) {
  const s = useSettings();
  const { w, error } = useWeather();
  useNow(60_000);
  if (!w) return <Empty>{error ?? "Loading weather..."}</Empty>;
  const today = w.daily[0];
  const lo = Math.min(...w.daily.map((d) => d.min));
  const hi = Math.max(...w.daily.map((d) => d.max));
  return (
    <div className="-m-4">
      <div className="relative overflow-hidden p-4 text-white" style={{ background: skyGradient(w.current.code, w.current.day) }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1 text-[13px] font-semibold"><MapPin size={12} /> {w.city}</div>
            <div className="mt-1 text-[54px] font-extralight leading-none">{w.current.temp}°</div>
            <div className="mt-1 text-[13px] font-medium">{skyLabel(w.current.code)}</div>
            <div className="text-[12px] opacity-80">H:{today.max}° L:{today.min}° · Feels like {w.current.feels}°</div>
          </div>
          <WeatherIcon code={w.current.code} day={w.current.day} size={72} />
        </div>
        <div className="thin-scroll mt-4 flex gap-4 overflow-x-auto border-t border-white/20 pt-3">
          {w.hourly.map((h, i) => (
            <div key={h.time} className="flex shrink-0 flex-col items-center gap-1">
              <span className="text-[11px] font-semibold opacity-85">{i === 0 ? "Now" : hourLabel(h.time, s.clock24)}</span>
              <WeatherIcon code={h.code} day={h.day} size={24} />
              <span className="text-[13px] font-semibold">{h.temp}°</span>
              {h.rain >= 20 && <span className="text-[9.5px] font-semibold text-[#9fd8ff]">{h.rain}%</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 pt-3">
        <div className="space-y-1">
          {w.daily.map((d, i) => (
            <div key={d.date} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-[44px] font-semibold">{dayName(d.date, i)}</span>
              <span className="w-[26px]"><WeatherIcon code={d.code} size={20} /></span>
              <span className="w-[34px] text-[10.5px] font-semibold text-[#64d2ff]">{d.rain >= 20 ? `${d.rain}%` : ""}</span>
              <span className="tabular w-[30px] text-right" style={{ color: "var(--fg2)" }}>{d.min}°</span>
              <div className="relative h-[5px] flex-1 rounded-full" style={{ background: "var(--track)" }}>
                <div className="absolute inset-y-0 rounded-full" style={{ left: `${((d.min - lo) / (hi - lo || 1)) * 100}%`, right: `${100 - ((d.max - lo) / (hi - lo || 1)) * 100}%`, background: "linear-gradient(90deg,#64d2ff,#ffd60a,#ff9f0a)" }} />
              </div>
              <span className="tabular w-[30px] font-semibold">{d.max}°</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
            <div className="text-[10.5px] font-semibold" style={{ color: "var(--fg2)" }}>SUN</div>
            <SunArc w={w} width={140} height={40} />
            <div className="flex justify-between text-[11px] font-semibold">
              <span className="flex items-center gap-1"><Sunrise size={12} className="text-[#ff9f0a]" />{hm(today.sunrise, s.clock24)}</span>
              <span className="flex items-center gap-1"><Sunset size={12} className="text-[#ff375f]" />{hm(today.sunset, s.clock24)}</span>
            </div>
          </div>
          <div className="grid grid-rows-3 gap-1.5 rounded-[14px] p-3 text-[12px]" style={{ background: "var(--chip)" }}>
            <span className="flex items-center justify-between"><span className="flex items-center gap-1.5" style={{ color: "var(--fg2)" }}><Droplets size={13} /> Humidity</span><b>{w.current.humidity}%</b></span>
            <span className="flex items-center justify-between"><span className="flex items-center gap-1.5" style={{ color: "var(--fg2)" }}><Wind size={13} /> Wind</span><b>{w.current.wind} {w.units === "f" ? "mph" : "km/h"}</b></span>
            <span className="flex items-center justify-between"><span className="flex items-center gap-1.5" style={{ color: "var(--fg2)" }}><Thermometer size={13} /> UV index</span><b>{Math.round(today.uv ?? 0)}</b></span>
          </div>
        </div>
        <div className="mt-2 text-right text-[10px]" style={{ color: "var(--fg3)" }}>Open-Meteo · updated {new Date(w.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}

const card = { Card: WeatherCard, cardWidth: 380 } as const;

export const weatherWidgets: WidgetDef[] = [
  { type: "weather", name: "Weather", category: "Weather", description: "The temperature and sky now, with today's high and low.", Tile: WeatherTile, ...card },
  { type: "weatherDetails", name: "Weather Details", category: "Weather", description: "Feels-like, humidity and wind beside the temperature.", Tile: WeatherDetailsTile, ...card },
  { type: "forecast", name: "Forecast", category: "Weather", description: "The next five days, one icon each.", Tile: ForecastTile, ...card },
  { type: "todayForecast", name: "Today's Forecast", category: "Weather", description: "Today's sky, high, low and chance of rain.", Tile: TodayForecastTile, ...card },
  { type: "weatherStatus", name: "Weather Status", category: "Weather", description: "The temperature on a tile painted like the sky.", Tile: WeatherStatusTile, ...card },
  { type: "hourly", name: "Hourly", category: "Weather", description: "The next six hours at a glance.", Tile: HourlyTile, ...card },
  { type: "sunriseSunset", name: "Sunrise & Sunset", category: "Weather", description: "When the sun comes up and goes down, and where it is now.", Tile: SunriseSunsetTile, ...card },
];
