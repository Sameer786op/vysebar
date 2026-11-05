// Settings, laid out like System Settings on a Mac: a sidebar of pages, grouped rows on the right.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, Calendar, ChevronDown, ChevronUp, Clock, ExternalLink, Info, KeyRound, LayoutGrid, MapPin, Monitor, Palette, Plus, Search, Trash2, X,
} from "lucide-react";
import { ACCENTS, type City, type DockStyle, type GoogleProfile, type Settings, type UpdateState } from "@shared/types";
import { PROVIDERS, type ProviderSpec } from "@shared/accounts";
import { liteOf, setSettings, uid, useCommitted, useSettings, useTopic } from "../lib/state";
import { play } from "../lib/sound";
import { Toggle } from "../components/ui";
import { VyseLogo, WindowsLogo } from "../components/icons";
import { lookOf } from "../dock/Dock";
import { widgetByType } from "../widgets/registry";
import { useWallpaper } from "./Picker";

const vyse = window.vyse;

const PAGES = [
  { id: "appearance", label: "Appearance", icon: Palette, color: "#0a84ff" },
  { id: "dock", label: "Dock", icon: Monitor, color: "#5e5ce6" },
  { id: "widgets", label: "Widgets", icon: LayoutGrid, color: "#30d158" },
  { id: "clock", label: "Clock & Weather", icon: Clock, color: "#ff9f0a" },
  { id: "calendars", label: "Calendars", icon: Calendar, color: "#ff453a" },
  { id: "accounts", label: "Accounts", icon: KeyRound, color: "#8e8e93" },
  { id: "notifications", label: "Notifications", icon: Bell, color: "#ff375f" },
  { id: "general", label: "General", icon: Info, color: "#64d2ff" },
] as const;

// ---------- building blocks ----------

function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <h3 className="mb-1.5 px-1 text-[12px] font-semibold" style={{ color: "var(--fg2)" }}>{title}</h3>}
      <div className="divide-y overflow-hidden rounded-[12px]" style={{ background: "rgb(255 255 255 / 0.05)", border: "1px solid var(--line)", borderColor: "var(--line)" }}>{children}</div>
      {footer && <p className="mt-1.5 px-1 text-[11.5px] leading-snug" style={{ color: "var(--fg3)" }}>{footer}</p>}
    </section>
  );
}

function Row({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center gap-4 px-3.5 py-2" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {sub && <div className="mt-0.5 text-[11.5px] leading-snug" style={{ color: "var(--fg2)" }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="relative flex rounded-[8px] p-[2px]" style={{ background: "rgb(255 255 255 / 0.08)" }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className="relative z-10 rounded-[6px] px-3 py-[4px] text-[12px] font-medium">
          {value === v && <motion.span layoutId={`seg-${options.map((o) => o[0]).join()}`} className="absolute inset-0 -z-10 rounded-[6px] shadow" style={{ background: "rgb(255 255 255 / 0.18)" }} transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          {label}
        </button>
      ))}
    </div>
  );
}

function Range({ value, min, max, step = 1, onChange, unit = "" }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  // saved while you drag (the dock follows a moment later) and the moment you let go
  const [v, setV, flush] = useCommitted(value, (n) => n !== value && onChange(n), 250);
  return (
    <div className="flex w-[240px] items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={flush} onKeyUp={flush} onBlur={flush} className="flex-1 accent-[var(--accent)]" />
      <span className="tabular w-[44px] text-right text-[12px]" style={{ color: "var(--fg2)" }}>{v}{unit}</span>
    </div>
  );
}

function Field({ value, onSave, placeholder, secret, width = 240 }: { value: string; onSave: (v: string) => void; placeholder?: string; secret?: boolean; width?: number }) {
  // kept as you type, so closing Settings mid-edit doesn't lose it
  const [v, setV, flush] = useCommitted(value, (n) => n.trim() !== value && onSave(n.trim()), 1200);
  return (
    <input
      type={secret ? "password" : "text"}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="rounded-[7px] px-2.5 py-[5px] text-[12.5px] outline-none placeholder:text-[var(--fg3)] focus:ring-2 focus:ring-[var(--accent)]"
      style={{ width, background: "rgb(255 255 255 / 0.08)", border: "1px solid var(--line)" }}
    />
  );
}

const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => setSettings({ [k]: v } as Partial<Settings>);

// ---------- appearance ----------

const STYLES: { id: DockStyle; name: string; sub: string }[] = [
  { id: "glass", name: "Liquid Glass", sub: "Live, refracting glass" },
  { id: "ios", name: "iOS", sub: "Bright frosted glass" },
  { id: "black", name: "Black", sub: "Solid and calm" },
  { id: "white", name: "White", sub: "Light and clean" },
  { id: "midnight", name: "Midnight", sub: "Deep blue to violet" },
  { id: "clear", name: "Clear", sub: "Just the tiles" },
];

function StylePreview({ s, style, wallpaper }: { s: Settings; style: DockStyle; wallpaper: string | null }) {
  const look = lookOf({ ...s, style });
  const glassy = look.glass !== "off";
  const tileBg = look.glass === "tiles" ? "rgb(30 30 34 / 0.35)" : look.rest;
  return (
    <div className="relative grid h-[92px] place-items-end overflow-hidden rounded-[12px] pb-2.5" style={{ background: wallpaper ? `center/cover url(${wallpaper})` : "linear-gradient(135deg,#3a4f7a,#7a4f8a)" }}>
      <div className="mx-auto flex items-center gap-[4px] rounded-[13px] p-[4px]" style={{ background: glassy && look.glass !== "tiles" ? (look.light ? "rgb(255 255 255 / 0.35)" : "rgb(30 30 34 / 0.3)") : look.plate, backdropFilter: glassy ? "blur(12px) saturate(1.7)" : undefined, boxShadow: look.shadow === "none" ? undefined : `0 4px 12px rgb(0 0 0 / 0.3), inset 0 0 0 1px ${look.border}` }}>
        {[0, 1, 2].map((i) => <span key={i} className="h-[22px] w-[22px] rounded-[7px]" style={{ background: ["#0a84ff", "#30d158", "#ff9f0a"][i] }} />)}
        {[52, 40].map((w) => (
          <span key={w} className="h-[24px] rounded-[8px]" style={{ width: w, background: tileBg, backdropFilter: look.glass === "tiles" ? "blur(12px)" : undefined, boxShadow: style === "clear" ? "0 3px 8px rgb(0 0 0 / 0.3)" : undefined }}>
            <span className="mx-1.5 mt-[9px] block h-[5px] rounded-full" style={{ background: look.light ? "rgb(0 0 0 / 0.35)" : "rgb(255 255 255 / 0.55)" }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Appearance({ s }: { s: Settings }) {
  const wallpaper = useWallpaper();
  const profile = useTopic<GoogleProfile | null>("profile");
  const file = useRef<HTMLInputElement>(null);
  const pickImage = (f: File) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const ctx = c.getContext("2d")!;
      const k = Math.max(96 / img.width, 96 / img.height);
      ctx.drawImage(img, (96 - img.width * k) / 2, (96 - img.height * k) / 2, img.width * k, img.height * k);
      setSettings({ startTile: "custom", startImage: c.toDataURL("image/png") });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  return (
    <>
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold" style={{ color: "var(--fg2)" }}>Style</h3>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {STYLES.map((st) => (
          <button key={st.id} onClick={() => setSettings({ style: st.id })} className="rounded-[14px] p-1.5 text-left transition-colors" style={{ background: s.style === st.id ? "rgb(10 132 255 / 0.15)" : "rgb(255 255 255 / 0.04)", outline: s.style === st.id ? "2px solid var(--accent)" : "1px solid var(--line)" }}>
            <StylePreview s={s} style={st.id} wallpaper={wallpaper} />
            <div className="px-1.5 pb-1 pt-2">
              <div className="text-[12.5px] font-semibold">{st.name}</div>
              <div className="text-[11px]" style={{ color: "var(--fg2)" }}>{st.sub}</div>
            </div>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {s.style === "clear" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Group title="Clear style">
              <Row label="Tiles" sub="With no plate behind them, the tiles carry the look">
                <Seg value={s.clearTiles} options={[["black", "Black"], ["white", "White"], ["frosted", "Frosted"]]} onChange={set("clearTiles")} />
              </Row>
            </Group>
          </motion.div>
        )}
      </AnimatePresence>
      <Group title="Accent colour" footer="Used for the active app, toggles, rings and selections.">
        <Row label="Accent">
          <div className="flex gap-2">
            {ACCENTS.map((c) => (
              <button key={c} onClick={() => setSettings({ accent: c })} className="grid h-[22px] w-[22px] place-items-center rounded-full transition-transform hover:scale-110" style={{ background: c, boxShadow: s.accent === c ? `0 0 0 2px var(--bg, #1c1c1e), 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Start button">
        <Row label="Icon">
          <div className="flex gap-2">
            {(["windows", "vyse", "custom", ...(profile?.photo ? (["google"] as const) : [])] as const).map((k) => (
              <button
                key={k}
                onClick={() => (k === "custom" && !s.startImage ? file.current?.click() : setSettings({ startTile: k }))}
                className="grid h-[40px] w-[40px] place-items-center overflow-hidden rounded-[11px]"
                style={{
                  background: k === "custom" && s.startImage ? `center/cover url(${s.startImage})` : k === "google" && profile?.photo ? `center/cover url(${profile.photo})` : "rgb(255 255 255 / 0.08)",
                  outline: s.startTile === k ? "2px solid var(--accent)" : "1px solid var(--line)",
                }}
                title={k === "custom" ? "Your own picture" : k === "google" ? "Your Google photo" : k === "vyse" ? "VyseBar" : "Windows"}
              >
                {k === "windows" && <WindowsLogo size={20} />}
                {k === "vyse" && <VyseLogo size={24} />}
                {k === "custom" && !s.startImage && <Plus size={16} />}
              </button>
            ))}
            {s.startImage && <button onClick={() => file.current?.click()} className="px-2 text-[12px]" style={{ color: "var(--accent)" }}>Change picture</button>}
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
          </div>
        </Row>
      </Group>
    </>
  );
}

// ---------- dock ----------

function DockPage({ s }: { s: Settings }) {
  return (
    <>
      <Group title="Position">
        <Row label="Screen edge"><Seg value={s.edge} options={[["bottom", "Bottom"], ["top", "Top"]]} onChange={set("edge")} /></Row>
        <Row label="Full width" sub="Edge to edge, apps on the left and widgets on the right"><Toggle on={s.fullWidth} onChange={set("fullWidth")} /></Row>
        <Row label="Show on"><Seg value={s.displays} options={[["primary", "Main display"], ["all", "All displays"]]} onChange={set("displays")} /></Row>
      </Group>
      <Group title="Size">
        <Row label="Size">
          <Seg value={s.size === 42 ? "s" : s.size === 48 ? "m" : s.size === 56 ? "l" : ("" as "s")} options={[["s", "Small"], ["m", "Medium"], ["l", "Large"]]} onChange={(v) => setSettings({ size: { s: 42, m: 48, l: 56 }[v] })} />
        </Row>
        <Row label="Dock height"><Range value={s.size} min={40} max={76} onChange={set("size")} unit="px" /></Row>
        <Row label="Space between tiles"><Range value={s.spacing} min={0} max={14} onChange={set("spacing")} unit="px" /></Row>
        <Row label="Distance from the edge"><Range value={s.distance} min={0} max={28} onChange={set("distance")} unit="px" /></Row>
      </Group>
      <Group title="Behaviour" footer="Windows keeps maximised apps clear of the dock unless it auto-hides or floats over them.">
        <Row label="Automatically hide" sub="Comes back when the pointer touches the screen edge"><Toggle on={s.autoHide} onChange={set("autoHide")} /></Row>
        <Row label="Float over windows" sub="Don't reserve space for the dock"><Toggle on={s.floatOver} disabled={s.autoHide} onChange={set("floatOver")} /></Row>
        <Row label="Replace the Windows taskbar" sub="VyseBar takes its place; it comes back when VyseBar quits"><Toggle on={s.hideTaskbar} onChange={set("hideTaskbar")} /></Row>
        {s.hideTaskbar && (
          <Row label="Windows taskbar" sub={s.taskbarMode === "autohide" ? "Slides up when the pointer touches the bottom edge" : "Out of sight while VyseBar runs"}>
            <Seg value={s.taskbarMode} options={[["hidden", "Hidden"], ["autohide", "Auto-hide"]]} onChange={set("taskbarMode")} />
          </Row>
        )}
        {s.hideTaskbar && (
          <Row label="Win+1 to 9 open dock apps" sub="Like the taskbar: add Shift for a new window, Alt for the app's menu"><Toggle on={s.winKeys} onChange={set("winKeys")} /></Row>
        )}
        <Row label="Lock the dock" sub="No dragging, reordering or removing"><Toggle on={s.lock} onChange={set("lock")} /></Row>
      </Group>
      <Group title="Apps">
        <Row label="Show app names on hover"><Toggle on={s.labels} onChange={set("labels")} /></Row>
        <Row label="Window previews on hover"><Toggle on={s.previews} onChange={set("previews")} /></Row>
        {s.previews && (
          <Row label="Peek at windows" sub="Pointing at a preview shows that window full size, like the taskbar"><Toggle on={s.peek} onChange={set("peek")} /></Row>
        )}
        <Row label="Import taskbar pins" sub="Copy the apps pinned to the Windows taskbar">
          <button onClick={() => void vyse.invoke("pins:importTaskbar")} className="rounded-[7px] px-3 py-[5px] text-[12px] font-medium" style={{ background: "rgb(255 255 255 / 0.1)" }}>Import</button>
        </Row>
      </Group>
    </>
  );
}

// ---------- widgets ----------

function WidgetsPage({ s }: { s: Settings }) {
  const move = (i: number, d: number) => {
    const list = [...s.widgets];
    const [w] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, i + d)), 0, w);
    setSettings({ widgets: list });
  };
  return (
    <>
      <div className="mb-5 flex items-center justify-between rounded-[12px] p-3.5" style={{ background: "rgb(255 255 255 / 0.05)", border: "1px solid var(--line)" }}>
        <div>
          <div className="text-[13px] font-semibold">{s.widgets.length} widgets on the dock</div>
          <div className="text-[11.5px]" style={{ color: "var(--fg2)" }}>Browse all of them, live, in the picker.</div>
        </div>
        <button onClick={() => void vyse.invoke("window:widgets")} className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold text-white" style={{ background: "var(--accent)" }}>Open Widgets</button>
      </div>
      <Group title="On the dock, left to right">
        <AnimatePresence initial={false}>
          {s.widgets.map((w, i) => {
            const def = widgetByType.get(w.type);
            return (
              <motion.div layout key={w.uid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                <Row label={def?.name ?? w.type} sub={def?.category}>
                  <div className="flex items-center gap-1">
                    <button disabled={i === 0} onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--chip)] disabled:opacity-30"><ChevronUp size={15} /></button>
                    <button disabled={i === s.widgets.length - 1} onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--chip)] disabled:opacity-30"><ChevronDown size={15} /></button>
                    <button onClick={() => setSettings({ widgets: s.widgets.filter((x) => x.uid !== w.uid) })} className="grid h-7 w-7 place-items-center rounded-md text-[#ff453a] hover:bg-[var(--chip)]"><Trash2 size={14} /></button>
                  </div>
                </Row>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Group>
    </>
  );
}

// ---------- clock & weather ----------

function CitySearch({ onPick, placeholder }: { onPick: (c: City) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<City[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => void vyse.invoke<City[]>("weather:search", q.trim()).then((r) => setRes(r ?? [])).catch(() => setRes([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <div className="flex w-[260px] items-center gap-2 rounded-[7px] px-2.5 py-[5px]" style={{ background: "rgb(255 255 255 / 0.08)", border: "1px solid var(--line)" }}>
        <Search size={13} style={{ color: "var(--fg2)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--fg3)]" />
      </div>
      {res.length > 0 && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[300px] overflow-hidden rounded-[10px] p-1 shadow-xl" style={{ background: "#2a2a2e", border: "1px solid var(--line)" }}>
          {res.map((c) => (
            <button key={`${c.lat},${c.lon}`} onClick={() => { onPick(c); setQ(""); setRes([]); }} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-[var(--accent)]">
              <MapPin size={13} className="shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.name}<span className="opacity-60"> · {c.country}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClockPage({ s }: { s: Settings }) {
  return (
    <>
      <Group title="Clock">
        <Row label="24-hour time"><Toggle on={s.clock24} onChange={set("clock24")} /></Row>
        <Row label="Show seconds"><Toggle on={s.clockSeconds} onChange={set("clockSeconds")} /></Row>
      </Group>
      <Group
        title="Weather"
        footer="Forecasts come from Open-Meteo; only the city's coordinates are sent. With your location on, BigDataCloud names the place: from Windows location rounded to about a kilometre, or from your IP address when Windows location is off."
      >
        <Row
          label="Use my location"
          sub={
            !s.cityAuto
              ? "Off: the weather stays on the city below"
              : s.city?.from === "windows"
                ? "From Windows location, checked every 3 hours"
                : s.city?.from === "ip"
                  ? "From your internet connection. Turn on Location for desktop apps in Windows for a precise city"
                  : "Finding where you are..."
          }
        >
          <Toggle on={s.cityAuto} onChange={(v) => setSettings({ cityAuto: v })} />
        </Row>
        <Row label="City" sub={s.city ? `${s.city.name}${s.city.country ? ", " + s.city.country : ""}` : "From your time zone"}>
          <CitySearch placeholder={s.cityAuto ? "Or pick a city yourself" : "Search for a city"} onPick={(c) => setSettings({ city: c, cityAuto: false })} />
        </Row>
        <Row label="Units"><Seg value={s.units} options={[["c", "°C"], ["f", "°F"]]} onChange={set("units")} /></Row>
      </Group>
      <Group title="World clocks">
        {s.worldClocks.map((w, i) => (
          <Row key={w.tz + i} label={w.name} sub={w.tz.replace(/_/g, " ")}>
            <button onClick={() => setSettings({ worldClocks: s.worldClocks.filter((_, j) => j !== i) })} className="grid h-7 w-7 place-items-center rounded-md text-[#ff453a] hover:bg-[var(--chip)]"><X size={14} /></button>
          </Row>
        ))}
        <Row label="Add a city">
          <CitySearch placeholder="City" onPick={(c) => c.tz && setSettings({ worldClocks: [...s.worldClocks, { name: c.name, tz: c.tz }] })} />
        </Row>
      </Group>
    </>
  );
}

// ---------- calendars ----------

const CAL_COLORS = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#64d2ff"];

function CalendarsPage({ s }: { s: Settings }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const add = () => {
    if (!/^(https?|webcal):\/\//i.test(url.trim())) return;
    setSettings({ calendars: [...s.calendars, { id: uid(), name: name.trim() || "Calendar", url: url.trim().replace(/^webcal:/i, "https:"), color: CAL_COLORS[s.calendars.length % CAL_COLORS.length] }] });
    setName("");
    setUrl("");
  };
  return (
    <>
      <Group title="Subscribed calendars" footer="In Google Calendar: Settings › your calendar › Secret address in iCal format. In Outlook: Settings › Calendar › Shared calendars › Publish. In iCloud: share the calendar publicly and copy the link.">
        {s.calendars.map((c) => (
          <Row key={c.id} label={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.name}</span>} sub={<span className="block max-w-[420px] truncate">{c.url}</span>}>
            <button onClick={() => setSettings({ calendars: s.calendars.filter((x) => x.id !== c.id) })} className="grid h-7 w-7 place-items-center rounded-md text-[#ff453a] hover:bg-[var(--chip)]"><Trash2 size={14} /></button>
          </Row>
        ))}
        {!s.calendars.length && <Row label={<span style={{ color: "var(--fg2)" }}>No calendars yet</span>} />}
      </Group>
      <Group title="Add a calendar">
        <Row label="Name"><Field value={name} onSave={setName} placeholder="Work" /></Row>
        <Row label="iCal link (.ics)"><Field value={url} onSave={setUrl} placeholder="https://calendar.google.com/...ics" width={320} /></Row>
        <Row label="">
          <button onClick={add} className="rounded-[7px] px-3 py-[5px] text-[12px] font-semibold text-white disabled:opacity-40" disabled={!url.trim()} style={{ background: "var(--accent)" }}>Add calendar</button>
        </Row>
      </Group>
    </>
  );
}

// ---------- accounts ----------

const GOOGLE_STEPS: [string, string, string][] = [
  ["Create a project", "Any name will do, like VyseBar.", "https://console.cloud.google.com/projectcreate"],
  ["Set up Google sign-in", "Google Auth Platform › Get started: app name VyseBar, your email, audience External.", "https://console.cloud.google.com/auth/overview"],
  ["Add yourself as a test user", "Audience › Test users › Add users: your Gmail address.", "https://console.cloud.google.com/auth/audience"],
  ["Make a client", "Clients › Create client › Desktop app. Copy its Client ID and Client secret into the fields below.", "https://console.cloud.google.com/auth/clients"],
];

function GoogleGroup({ s }: { s: Settings }) {
  const profile = useTopic<GoogleProfile | null>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const hasClient = !!s.google.clientId.trim() && !!s.google.clientSecret.trim();
  const showSetup = !profile && (!hasClient || editing);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    const r = await vyse.invoke<{ ok: true } | { error: string }>("google:signIn").catch((e: Error) => ({ error: e.message }));
    setBusy(false);
    if ("error" in r) setError(r.error);
    else setEditing(false);
  };
  const saveClient = (k: "clientId" | "clientSecret") => (v: string) => setSettings({ google: { ...s.google, [k]: v.trim() } });
  const button = "rounded-[7px] px-3 py-[5px] text-[12px] font-semibold disabled:opacity-40";
  return (
    <Group title="Google" footer="VyseBar asks Google only for your name, email address and profile photo. They stay on this PC, and the sign-in is stored encrypted for your Windows account.">
      {profile ? (
        <Row
          label={
            <span className="flex items-center gap-2.5">
              {profile.photo ? <img src={profile.photo} alt="" className="h-[30px] w-[30px] rounded-full object-cover" /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--accent)] text-[13px] font-semibold text-white">{profile.givenName.slice(0, 1)}</span>}
              {profile.name}
            </span>
          }
          sub={profile.valid ? profile.email : "Google ended this sign-in. Sign in again to keep your photo up to date."}
        >
          {!profile.valid && <button onClick={() => void signIn()} disabled={busy} className={button} style={{ background: "var(--accent)", color: "white" }}>{busy ? "Waiting for your browser..." : "Sign in again"}</button>}
          <button onClick={() => void vyse.invoke("google:signOut")} className="text-[12px]" style={{ color: "#ff453a" }}>Sign out</button>
        </Row>
      ) : (
        <Row label="Sign in with Google" sub={hasClient ? "Your name and photo on the dock" : "First, a one-time setup in Google Cloud (about 5 minutes)"}>
          {hasClient && !editing && <button onClick={() => setEditing(true)} className="text-[12px]" style={{ color: "var(--fg2)" }}>Edit client</button>}
          <button onClick={() => void signIn()} disabled={!hasClient || busy} className={button} style={{ background: "var(--accent)", color: "white" }}>
            {busy ? "Waiting for your browser..." : "Sign in"}
          </button>
        </Row>
      )}
      {error && <p className="px-3.5 pb-2.5 text-[12px]" style={{ color: "#ff453a" }}>{error}</p>}
      {showSetup && (
        <div className="space-y-2.5 px-3.5 pb-3.5 pt-1">
          <p className="text-[12px] leading-snug" style={{ color: "var(--fg2)" }}>
            Google lets an app sign you in only with its own client ID. Make a free one for yourself in Google Cloud; you only do this once.
          </p>
          <ol className="space-y-1.5">
            {GOOGLE_STEPS.map(([title, how, url], i) => (
              <li key={title} className="flex items-start gap-2.5 text-[12px] leading-snug">
                <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10.5px] font-semibold" style={{ background: "rgb(255 255 255 / 0.1)" }}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{title}.</span> <span style={{ color: "var(--fg2)" }}>{how}</span>{" "}
                  <button onClick={() => void vyse.invoke("open:url", url)} className="inline-flex items-center gap-0.5 underline" style={{ color: "var(--accent)" }}>Open<ExternalLink size={10} /></button>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-3 pt-1">
            <span className="w-[100px] text-[12px]" style={{ color: "var(--fg2)" }}>Client ID</span>
            <Field value={s.google.clientId} onSave={saveClient("clientId")} placeholder="...apps.googleusercontent.com" width={320} />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-[100px] text-[12px]" style={{ color: "var(--fg2)" }}>Client secret</span>
            <Field value={s.google.clientSecret} onSave={saveClient("clientSecret")} placeholder="GOCSPX-..." secret width={320} />
          </div>
        </div>
      )}
    </Group>
  );
}

function AccountsPage({ s }: { s: Settings }) {
  const acc = (k: keyof Settings["accounts"]) => (v: string) => setSettings({ accounts: { ...s.accounts, [k]: v || undefined } });
  return (
    <>
      <GoogleGroup s={s} />
      <Group title="GitHub" footer="Your public contribution graph needs only the username. A token (no scopes needed beyond notifications) adds your unread notifications.">
        <Row label="Username"><Field value={s.accounts.githubUser ?? ""} onSave={acc("githubUser")} placeholder="octocat" /></Row>
        <Row label="Token" sub="Optional"><Field value={s.accounts.githubToken ?? ""} onSave={acc("githubToken")} placeholder="ghp_..." secret /></Row>
      </Group>
      <Group title="Stocks" footer="Get a free key at finnhub.io. Quotes refresh every minute.">
        <Row label="Finnhub API key"><Field value={s.accounts.finnhubKey ?? ""} onSave={acc("finnhubKey")} placeholder="Your key" secret /></Row>
        <Row label="Tickers"><Field value={s.tickers.join(", ")} onSave={(v) => setSettings({ tickers: v.split(/[\s,]+/).map((t) => t.toUpperCase()).filter(Boolean).slice(0, 6) })} placeholder="AAPL, NVDA" /></Row>
      </Group>
      <Group title="Stripe" footer="Create a restricted key with read access to Balance transactions only. It stays on this PC.">
        <Row label="Restricted key"><Field value={s.accounts.stripeKey ?? ""} onSave={acc("stripeKey")} placeholder="rk_live_..." secret /></Row>
        <Row label="Monthly goal"><Field value={String(s.revenueGoal)} onSave={(v) => setSettings({ revenueGoal: Number(v) || 1000 })} width={120} /></Row>
      </Group>
      <Group title="Crypto">
        <Row label="Coin" sub="Its CoinGecko id, like bitcoin or ethereum"><Field value={s.crypto} onSave={(v) => setSettings({ crypto: v.toLowerCase() || "bitcoin" })} /></Row>
      </Group>
      {(["Finance", "Analytics", "Developer", "Social", "AI"] as const).map((g) => (
        <Group key={g} title={g === "Finance" ? "More stores" : g} footer={g === "Finance" ? "Every connected store, Stripe included, adds up in the Total Revenue widget." : undefined}>
          {PROVIDERS.filter((p) => p.group === g).map((p) => <ProviderRow key={p.id} spec={p} s={s} />)}
        </Group>
      ))}
      <p className="px-1 text-[11.5px]" style={{ color: "var(--fg3)" }}>Keys are saved in VyseBar's settings file on this PC and only sent to the service they belong to.</p>
    </>
  );
}

function ProviderRow({ spec, s }: { spec: ProviderSpec; s: Settings }) {
  const keys = s.providers[spec.id] ?? {};
  const connected = spec.fields.every((f) => keys[f.key]);
  const [open, setOpen] = useState(false);
  const save = (k: string) => (v: string) => setSettings({ providers: { ...s.providers, [spec.id]: { ...keys, [k]: v } } });
  return (
    <div style={{ borderColor: "var(--line)" }}>
      <Row
        label={
          <span className="flex items-center gap-2">
            <span className="grid h-[20px] w-[20px] place-items-center rounded-[6px] text-[10px] font-bold text-white" style={{ background: spec.color, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14)" }}>{spec.letter}</span>
            {spec.name}
          </span>
        }
        sub={connected ? "Connected" : undefined}
      >
        {connected && (
          <button onClick={() => { const { [spec.id]: _gone, ...rest } = s.providers; setSettings({ providers: rest }); }} className="text-[12px]" style={{ color: "#ff453a" }}>
            Disconnect
          </button>
        )}
        <button onClick={() => setOpen(!open)} className="rounded-[7px] px-2.5 py-[4px] text-[12px] font-medium" style={{ background: open ? "var(--accent)" : "rgb(255 255 255 / 0.1)", color: open ? "white" : undefined }}>
          {connected ? "Edit" : "Connect"}
        </button>
      </Row>
      {open && (
        <div className="space-y-2 px-3.5 pb-3">
          {spec.fields.map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <span className="w-[120px] text-[12px]" style={{ color: "var(--fg2)" }}>{f.label}</span>
              <Field value={keys[f.key] ?? ""} onSave={save(f.key)} placeholder={f.placeholder} secret={f.secret} width={260} />
            </div>
          ))}
          <p className="text-[11.5px] leading-snug" style={{ color: "var(--fg3)" }}>
            {spec.help}{" "}
            <button onClick={() => void vyse.invoke("open:url", spec.site)} className="underline" style={{ color: "var(--accent)" }}>Open {spec.name}</button>
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- notifications ----------

function NotificationsPage({ s }: { s: Settings }) {
  const auto = (k: keyof Settings["automations"]) => (v: boolean) => setSettings({ automations: { ...s.automations, [k]: v } });
  return (
    <>
      <Group title="Sound">
        <Row label="Play a sound with alerts"><Toggle on={s.sounds.on} onChange={(on) => setSettings({ sounds: { ...s.sounds, on } })} /></Row>
        <Row label="Tone">
          <Seg value={s.sounds.tone} options={[["glass", "Glass"], ["chime", "Chime"], ["pop", "Pop"], ["bell", "Bell"]]} onChange={(tone) => { setSettings({ sounds: { ...s.sounds, tone } }); play(tone); }} />
        </Row>
      </Group>
      <Group title="Quiet hours" footer="Alerts still appear, silently.">
        <Row label="Quiet hours"><Toggle on={s.quietHours.on} onChange={(on) => setSettings({ quietHours: { ...s.quietHours, on } })} /></Row>
        <Row label="From">
          <input type="time" value={s.quietHours.from} onChange={(e) => setSettings({ quietHours: { ...s.quietHours, from: e.target.value } })} className="rounded-[7px] px-2 py-[4px] text-[12.5px] outline-none" style={{ background: "rgb(255 255 255 / 0.08)" }} />
        </Row>
        <Row label="To">
          <input type="time" value={s.quietHours.to} onChange={(e) => setSettings({ quietHours: { ...s.quietHours, to: e.target.value } })} className="rounded-[7px] px-2 py-[4px] text-[12.5px] outline-none" style={{ background: "rgb(255 255 255 / 0.08)" }} />
        </Row>
      </Group>
      <Group title="Automations">
        <Row label="Remind me before events" sub="Five minutes ahead, from every calendar"><Toggle on={s.automations.eventReminders} onChange={auto("eventReminders")} /></Row>
        <Row label="Pause music when an event starts"><Toggle on={s.automations.pauseMusicForEvents} onChange={auto("pauseMusicForEvents")} /></Row>
        <Row label="Claude usage alerts" sub="At 80% of your session limit, and when it resets"><Toggle on={s.automations.aiLimits} onChange={auto("aiLimits")} /></Row>
        <Row label="Battery low"><Toggle on={s.automations.batteryLow} onChange={auto("batteryLow")} /></Row>
        <Row label="Storage almost full"><Toggle on={s.automations.storageLow} onChange={auto("storageLow")} /></Row>
      </Group>
      <button onClick={() => void vyse.invoke("toast:test")} className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium" style={{ background: "rgb(255 255 255 / 0.1)" }}>Send a test alert</button>
    </>
  );
}

// ---------- general ----------

// what the updater is doing, and the one button that fits it
function UpdateStatus() {
  const [u, setU] = useState<UpdateState | null>(null);
  useEffect(() => {
    void vyse.invoke<UpdateState>("update:get").then(setU);
    return vyse.on("update", (v: UpdateState) => setU(v));
  }, []);
  if (!u) return null;
  const line = {
    off: "Updates are off in a development build",
    idle: "Updates are checked automatically",
    checking: "Checking for updates...",
    latest: "Up to date",
    downloading: `Downloading ${u.next ?? "an update"}${u.percent ? ` · ${u.percent}%` : ""}`,
    ready: `Version ${u.next} is ready to install`,
    error: "Couldn't check for updates. Are you online?",
  }[u.status];
  const btn = "rounded-[7px] px-3 py-[5px] text-[12px] font-medium";
  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="text-[12px]" style={{ color: u.status === "ready" ? "var(--fg)" : "var(--fg2)" }} title={u.error}>{line}</span>
      {u.status === "ready" ? (
        <button onClick={() => void vyse.invoke("update:install")} className={`${btn} text-white`} style={{ background: "var(--accent, #0a84ff)" }}>Restart to update</button>
      ) : u.status === "latest" || u.status === "error" || u.status === "idle" ? (
        <button onClick={() => void vyse.invoke("update:check")} className={btn} style={{ background: "rgb(255 255 255 / 0.1)" }}>Check now</button>
      ) : null}
    </div>
  );
}

function GeneralPage({ s }: { s: Settings }) {
  const [version, setVersion] = useState("");
  useEffect(() => void vyse.invoke<string>("app:version").then(setVersion), []);
  return (
    <>
      <div className="mb-6 flex items-center gap-4 rounded-[14px] p-4" style={{ background: "rgb(255 255 255 / 0.05)", border: "1px solid var(--line)" }}>
        <VyseLogo size={52} />
        <div>
          <div className="text-[17px] font-semibold">VyseBar</div>
          <div className="text-[12px]" style={{ color: "var(--fg2)" }}>Version {version} · A smart dock for Windows</div>
        </div>
        <UpdateStatus />
      </div>
      <Group title="Startup">
        <Row label="Open VyseBar when you sign in"><Toggle on={s.launchAtStartup} onChange={set("launchAtStartup")} /></Row>
      </Group>
      <Group
        title="Performance"
        footer={vyse.env.lowEnd ? "This PC is 32-bit or has 4 GB of RAM or less, so Auto uses Lite." : "Auto uses Lite on 32-bit PCs and PCs with 4 GB of RAM or less. Some changes apply after a restart."}
      >
        <Row label="Mode" sub={liteOf(s) ? "Lite: glass bends the wallpaper instead of the live screen, gauges don't animate, readings refresh half as often" : "Smooth: live glass and every animation"}>
          <Seg value={s.performance} options={[["auto", "Auto"], ["smooth", "Smooth"], ["lite", "Lite"]]} onChange={set("performance")} />
        </Row>
      </Group>
      <Group title="VyseBar">
        <Row label="Restart VyseBar"><button onClick={() => void vyse.invoke("app:restart")} className="rounded-[7px] px-3 py-[5px] text-[12px] font-medium" style={{ background: "rgb(255 255 255 / 0.1)" }}>Restart</button></Row>
        <Row label="Quit VyseBar" sub="The Windows taskbar comes back"><button onClick={() => void vyse.invoke("app:quit")} className="rounded-[7px] px-3 py-[5px] text-[12px] font-medium text-[#ff453a]" style={{ background: "rgb(255 255 255 / 0.1)" }}>Quit</button></Row>
      </Group>
    </>
  );
}

// ---------- the window ----------

export function SettingsWindow({ page: initial }: { page: string }) {
  const s = useSettings();
  const [page, setPage] = useState(initial);
  useEffect(() => setPage(initial), [initial]);
  useEffect(() => {
    document.documentElement.classList.add("theme-dark");
    document.title = "VyseBar Settings";
  }, []);
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const body = {
    appearance: <Appearance s={s} />,
    dock: <DockPage s={s} />,
    widgets: <WidgetsPage s={s} />,
    clock: <ClockPage s={s} />,
    calendars: <CalendarsPage s={s} />,
    accounts: <AccountsPage s={s} />,
    notifications: <NotificationsPage s={s} />,
    general: <GeneralPage s={s} />,
  }[current.id];
  return (
    <div className="flex h-full" style={{ color: "var(--fg)", background: "rgb(24 24 28 / 0.55)" }}>
      <aside className="flex w-[220px] shrink-0 flex-col pt-[48px]" style={{ background: "rgb(0 0 0 / 0.2)", borderRight: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 px-4 pb-3 [-webkit-app-region:drag]">
          <VyseLogo size={22} />
          <span className="text-[15px] font-bold">VyseBar</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {PAGES.map((p) => (
            <button key={p.id} onClick={() => setPage(p.id)} className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[6px] text-left text-[13px] transition-colors" style={{ background: page === p.id ? "var(--accent)" : undefined, color: page === p.id ? "white" : undefined }}>
              <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px] text-white" style={{ background: p.color }}><p.icon size={13} /></span>
              {p.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-[48px] shrink-0 px-7 pt-[13px] text-[16px] font-semibold [-webkit-app-region:drag]">{current.label}</div>
        <div className="thin-scroll flex-1 overflow-y-auto px-7 pb-10 pt-2">
          <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            {body}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
