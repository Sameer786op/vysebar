// Temperature, a wallpaper gallery, GitHub notifications and ChatGPT's Codex limits.
import { useState } from "react";
import { Bell, Check, Image as ImageIcon, Loader2, Terminal, Thermometer } from "lucide-react";
import { countdown } from "../lib/format";
import { useNow, useSettings, useTopic } from "../lib/state";
import { CardHeader, Ring } from "../components/ui";
import type { CardProps, WidgetDef } from "./types";

type Err = { error: string };
const isErr = (v: unknown): v is Err => !!v && typeof v === "object" && "error" in v;
const muted = { color: "var(--fg2)" };

// ---------- temperature ----------

type Sensor = { name: string; c: number };

function useTemp() {
  const s = useSettings();
  const list = useTopic<Sensor[] | null>("temperature");
  const fmt = (c: number) => (s.units === "f" ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`);
  const hottest = list?.length ? Math.max(...list.map((x) => x.c)) : null;
  return { list, fmt, hottest };
}

const heat = (c: number) => (c >= 85 ? "#ff453a" : c >= 70 ? "#ff9f0a" : c >= 55 ? "#ffd60a" : "#30d158");

function TemperatureTile() {
  const { list, fmt, hottest } = useTemp();
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3.5">
      <Ring value={hottest == null ? 0 : Math.min(1, hottest / 100)} size={32} stroke={3.5} color={hottest == null ? "var(--fg3)" : heat(hottest)}>
        <Thermometer size={14} />
      </Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{hottest == null ? "--" : fmt(hottest)}</span>
        <span className="mt-1 text-[10px]" style={muted}>{list === undefined ? "Reading..." : hottest == null ? "No sensor" : "system"}</span>
      </div>
    </div>
  );
}

function TemperatureCard(_: CardProps) {
  const { list, fmt } = useTemp();
  return (
    <div>
      <CardHeader title={<span className="flex items-center gap-1.5"><Thermometer size={15} /> Temperature</span>} sub="The thermal zones Windows reports" />
      {list?.length ? (
        <div className="space-y-2">
          {list.map((x) => (
            <div key={x.name} className="flex items-center gap-2.5 rounded-[12px] px-3 py-2" style={{ background: "var(--chip)" }}>
              <span className="min-w-0 flex-1 truncate text-[12px]">{x.name.replace(/^\\_TZ\./, "Zone ")}</span>
              <div className="h-[6px] w-[110px] overflow-hidden rounded-full" style={{ background: "var(--track)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, x.c)}%`, background: heat(x.c) }} />
              </div>
              <span className="tabular w-[44px] text-right text-[13px] font-semibold">{fmt(x.c)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-5 text-center text-[12px] leading-snug" style={muted}>
          {list === undefined ? "Reading..." : "This PC doesn't share a temperature with Windows. Many desktops only report it to their maker's own tools."}
        </div>
      )}
    </div>
  );
}

// ---------- wallpaper gallery ----------

interface Picture { id: string; title: string; credit: string; thumb: string; full: string }

function WallpaperTile() {
  const w = useTopic<Picture[] | Err>("wallpapers");
  const today = Array.isArray(w) ? w[0] : null;
  return (
    <div className="flex h-full items-center gap-2.5 pl-2 pr-3.5">
      {today ? <img src={today.thumb} className="h-[34px] w-[52px] rounded-[8px] object-cover" /> : <div className="grid h-[34px] w-[52px] place-items-center rounded-[8px]" style={{ background: "var(--chip)" }}><ImageIcon size={15} /></div>}
      <div className="flex max-w-[120px] flex-col leading-none">
        <span className="truncate text-[12.5px] font-semibold">{today?.title || "Wallpapers"}</span>
        <span className="mt-1 text-[10px]" style={muted}>{isErr(w) ? "Offline" : "Picture of the day"}</span>
      </div>
    </div>
  );
}

function WallpaperCard(_: CardProps) {
  const w = useTopic<Picture[] | Err>("wallpapers");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const set = async (p: Picture) => {
    setBusy(p.id);
    setErr("");
    try {
      await window.vyse.invoke("wallpaper:set", p.full, p.id);
      setDone(p.id);
    } catch (e) {
      setErr((e as Error).message.replace(/^.*Error: /, ""));
    }
    setBusy(null);
  };
  return (
    <div>
      <CardHeader title="Wallpaper Gallery" sub="Bing's pictures of the day; click one to use it" />
      {!w ? (
        <div className="py-6 text-center text-[12px]" style={muted}>Loading...</div>
      ) : isErr(w) ? (
        <div className="py-6 text-center text-[12px]" style={muted}>Couldn't load the gallery: {w.error}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {w.map((p) => (
            <button key={p.id} title={p.credit} onClick={() => void set(p)} className="group relative overflow-hidden rounded-[12px] text-left">
              <img src={p.thumb} className="aspect-[5/3] w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-[10.5px] font-medium text-white">{p.title}</span>
              {(busy === p.id || done === p.id) && (
                <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white">
                  {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {err && <div className="mt-2 text-[11px]" style={{ color: "#ff453a" }}>{err}</div>}
    </div>
  );
}

// ---------- GitHub notifications ----------

function GithubNotificationsTile() {
  const g = useTopic<{ notifications: number | null } | Err>("github");
  const n = g && !isErr(g) ? g.notifications : null;
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3.5">
      <div className="relative grid h-[32px] w-[32px] place-items-center rounded-full" style={{ background: "var(--chip)" }}>
        <Bell size={15} />
        {!!n && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-[#ff453a] px-1 text-center text-[9.5px] font-bold leading-[16px] text-white">{n > 99 ? "99+" : n}</span>}
      </div>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[14px] font-semibold">{n == null ? "--" : n}</span>
        <span className="mt-1 text-[10px]" style={muted}>{g && !isErr(g) && n == null ? "Add a token" : "unread"}</span>
      </div>
    </div>
  );
}

// ---------- ChatGPT Codex limits ----------

interface Win { used: number; minutes: number | null; resetsAt: number | null }
interface Codex { session: Win | null; week: Win | null; plan: string | null; at: number }
const CODEX = "#10a37f";
// the log only has the share as of the last reply; once its window has reset, nothing is used
const until = (ms: number, short = false) => (ms > 48 * 3600_000 ? `${Math.round(ms / 86400_000)} days` : short ? countdown(ms).replace(/:\d\d$/, "") : countdown(ms));
const usedNow = (w: Win | null, now: number) => (!w ? null : w.resetsAt && w.resetsAt <= now ? 0 : w.used);
const winName = (w: Win | null, fallback: string) => (w?.minutes ? (w.minutes >= 1440 ? `${Math.round(w.minutes / 1440)}-day` : `${Math.round(w.minutes / 60)}-hour`) : fallback);

function CodexTile() {
  const c = useTopic<Codex | Err>("codex");
  const now = useNow(30_000);
  if (!c || isErr(c))
    return (
      <div className="flex h-full items-center gap-2 pl-2.5 pr-3">
        <div className="grid h-[32px] w-[32px] place-items-center rounded-[10px] text-white" style={{ background: CODEX }}><Terminal size={16} /></div>
        <span className="max-w-[120px] truncate text-[11px]" style={muted}>{c ? c.error : "Reading..."}</span>
      </div>
    );
  const s = c.session;
  const used = usedNow(s, now);
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5">
      <Ring value={(used ?? 0) / 100} size={34} stroke={3.5} color={(used ?? 0) >= 80 ? "#ff453a" : CODEX}><Terminal size={14} style={{ color: CODEX }} /></Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{used == null ? "--" : `${used}%`}</span>
        <span className="tabular mt-1 text-[10px]" style={muted}>{s?.resetsAt && s.resetsAt > now ? `resets in ${until(s.resetsAt - now, true)}` : "Codex"}</span>
      </div>
    </div>
  );
}

function CodexCard(_: CardProps) {
  const c = useTopic<Codex | Err>("codex");
  const now = useNow(1000);
  if (!c || isErr(c)) return <div className="py-6 text-center text-[12px]" style={muted}>{c ? c.error : "Reading..."}</div>;
  return (
    <div>
      <CardHeader title={<span className="flex items-center gap-1.5"><Terminal size={15} style={{ color: CODEX }} /> Codex</span>} sub={`${c.plan ? `${c.plan[0].toUpperCase()}${c.plan.slice(1)} plan · ` : ""}limits from Codex's logs on this PC`} />
      <div className={`grid gap-2 ${c.session && c.week ? "grid-cols-2" : "grid-cols-1"}`}>
        {([[c.session, "5-hour"], [c.week, "Weekly"]] as const)
          .filter(([w], i) => w || (i === 0 && !c.week))
          .map(([w, fallback]) => {
            const used = usedNow(w, now);
            return (
              <div key={fallback} className="flex flex-col items-center rounded-[16px] p-3" style={{ background: "var(--chip)" }}>
                <Ring value={(used ?? 0) / 100} size={78} stroke={7} color={(used ?? 0) >= 80 ? "#ff453a" : CODEX}>
                  <span className="tabular text-[17px] font-semibold">{used == null ? "--" : `${used}%`}</span>
                </Ring>
                <div className="mt-2 text-[12px] font-semibold">{winName(w, fallback)} limit</div>
                <div className="tabular text-[10.5px]" style={muted}>{!w?.resetsAt ? "-" : w.resetsAt > now ? `resets in ${until(w.resetsAt - now)}` : `reset ${new Date(w.resetsAt).toLocaleDateString([], { month: "short", day: "numeric" })}`}</div>
              </div>
            );
          })}
      </div>
      <div className="mt-2 text-center text-[10.5px]" style={{ color: "var(--fg3)" }}>As of your last Codex reply, {new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
    </div>
  );
}

export const extraWidgets: WidgetDef[] = [
  { type: "temperature", name: "Temperature", category: "System", description: "How warm the PC runs, from the sensors Windows can read.", Tile: TemperatureTile, Card: TemperatureCard, cardWidth: 330 },
  { type: "wallpapers", name: "Wallpaper Gallery", category: "Online & Mail", description: "A fresh picture every day; set any of the last eight as your wallpaper.", Tile: WallpaperTile, Card: WallpaperCard, cardWidth: 380 },
  { type: "githubNotifications", name: "GitHub Notifications", category: "Developer", description: "Unread GitHub notifications; a click opens them.", Tile: GithubNotificationsTile, action: () => void window.vyse.invoke("open:url", "https://github.com/notifications"), account: "GitHub token" },
  { type: "codex", name: "ChatGPT Codex", category: "AI", description: "Codex's 5-hour and weekly limits and when they reset.", Tile: CodexTile, Card: CodexCard, cardWidth: 340 },
];
