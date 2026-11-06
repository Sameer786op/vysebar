// What the PC is doing: load, memory, network, battery, drives, and the switches you reach for.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowDown, ArrowUp, BatteryCharging, Bell, BellOff, Bluetooth, BluetoothOff, Camera, CameraOff, Check, Coffee, Cpu, Gamepad2, HardDrive, Headphones, Keyboard, Laptop,
  LayoutGrid, Leaf, MemoryStick, Mic, MicOff, MonitorSmartphone, Moon, Mouse, Pencil, Plane, RadioTower, Settings2, SlidersHorizontal, Smartphone, Speaker, Sun, SunMedium,
  Trash2, Volume2, VolumeX, Watch, Wifi, WifiOff,
} from "lucide-react";
import type { WidgetInstance } from "@shared/types";
import { bytes, duration, speed } from "../lib/format";
import { host, refreshTopic, setSettings, setWidgetConfig, useBattery, useNow, useStore, useTopic } from "../lib/state";
import { Bar, CardHeader, Empty, Ring, Slider, Sparkline, Toggle } from "../components/ui";
import type { CardProps, MenuItem, TileProps, WidgetDef } from "./types";

const stop = (e: React.MouseEvent) => e.stopPropagation();

interface SystemInfo { cpu: number; ram: number; ramUsed: number; ramTotal: number; cpuHistory: number[]; cores: number; model?: string }
interface NetInfo { down: number; up: number; connected: boolean; kind: string | null; history: { rx: number; tx: number }[] }
interface Drive { letter: string; total: number; free: number }
interface Volume { volume: number; muted: boolean; device: string; id: string }
interface Radio { kind: string; name: string; on: boolean; state: string }
interface KeyboardInfo { code: string; name: string; all: { code: string; name: string; id: number }[] }

const loadColor = (v: number) => (v >= 85 ? "#ff453a" : v >= 60 ? "#ff9f0a" : "#30d158");

function EthernetIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M8 9V5h8v4M8 20v-4M12 20v-4M16 20v-4" />
    </svg>
  );
}

// ---------- system stats ----------

function SystemStatsTile() {
  const s = useTopic<SystemInfo>("system");
  const n = useTopic<NetInfo>("network");
  return (
    <div className="flex h-full items-center gap-3 px-3">
      {(["cpu", "ram"] as const).map((k) => (
        <div key={k} className="flex items-center gap-1.5">
          <Ring value={(s?.[k] ?? 0) / 100} size={32} stroke={3.5} color={loadColor(s?.[k] ?? 0)}>
            <span className="tabular text-[9.5px] font-bold">{s?.[k] ?? 0}</span>
          </Ring>
          <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--fg2)" }}>{k}</span>
        </div>
      ))}
      <div className="flex flex-col gap-[3px] text-[10.5px] font-semibold leading-none">
        <span className="tabular flex items-center gap-0.5"><ArrowDown size={10} className="text-[#64d2ff]" />{speed(n?.down ?? 0)}</span>
        <span className="tabular flex items-center gap-0.5" style={{ color: "var(--fg2)" }}><ArrowUp size={10} className="text-[#bf5af2]" />{speed(n?.up ?? 0)}</span>
      </div>
    </div>
  );
}

function SystemCard(_: CardProps) {
  const s = useTopic<SystemInfo>("system");
  const n = useTopic<NetInfo>("network");
  const st = useTopic<{ drives: Drive[] }>("storage");
  const b = useBattery();
  return (
    <div>
      <CardHeader title="System" sub={s?.model?.replace(/\s+/g, " ").trim()} right={<button onClick={() => window.vyse.invoke("run", "taskmgr")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Task Manager</button>} />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="flex items-center justify-between text-[11.5px] font-semibold" style={{ color: "var(--fg2)" }}>
            <span className="flex items-center gap-1"><Cpu size={12} /> CPU</span>
            <span>{s?.cores ?? "-"} cores</span>
          </div>
          <div className="tabular mt-1 text-[24px] font-semibold" style={{ color: loadColor(s?.cpu ?? 0) }}>{s?.cpu ?? 0}%</div>
          <Sparkline values={s?.cpuHistory ?? []} width={150} height={36} color={loadColor(s?.cpu ?? 0)} />
        </div>
        <div className="rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--fg2)" }}><MemoryStick size={12} /> Memory</div>
          <div className="tabular mt-1 text-[24px] font-semibold" style={{ color: loadColor(s?.ram ?? 0) }}>{s?.ram ?? 0}%</div>
          <div className="mt-2 text-[11px]" style={{ color: "var(--fg2)" }}>{s ? `${bytes(s.ramUsed)} of ${bytes(s.ramTotal, 0)}` : "..."}</div>
          <Bar value={(s?.ram ?? 0) / 100} color={loadColor(s?.ram ?? 0)} className="mt-2" />
        </div>
        <div className="col-span-2 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
          <div className="flex items-center justify-between text-[11.5px] font-semibold" style={{ color: "var(--fg2)" }}>
            <span className="flex items-center gap-1">{n?.kind === "ethernet" ? <EthernetIcon size={12} /> : <Wifi size={12} />} Network</span>
            <span>{n?.connected ? (n.kind === "ethernet" ? "Ethernet" : "Wi-Fi") : "Offline"}</span>
          </div>
          <div className="mt-1 flex gap-5">
            <div className="tabular flex items-center gap-1 text-[16px] font-semibold"><ArrowDown size={14} className="text-[#64d2ff]" />{speed(n?.down ?? 0)}</div>
            <div className="tabular flex items-center gap-1 text-[16px] font-semibold"><ArrowUp size={14} className="text-[#bf5af2]" />{speed(n?.up ?? 0)}</div>
          </div>
          <div className="relative mt-1 h-[36px]">
            <div className="absolute inset-0"><Sparkline values={n?.history.map((h) => h.rx) ?? []} width={330} height={36} color="#64d2ff" /></div>
            <div className="absolute inset-0"><Sparkline values={n?.history.map((h) => h.tx) ?? []} width={330} height={36} color="#bf5af2" fill={false} strokeWidth={1.2} /></div>
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {st?.drives.map((d) => <DriveRow key={d.letter} d={d} />)}
        {b && (
          <div className="flex items-center gap-2 text-[12px]">
            <BatteryCharging size={14} style={{ color: "var(--fg2)" }} />
            <span className="flex-1">Battery</span>
            <span className="tabular font-semibold">{Math.round(b.level * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DriveRow({ d }: { d: Drive }) {
  const used = 1 - d.free / d.total;
  return (
    <button className="block w-full text-left" onClick={() => window.vyse.invoke("open:path", `${d.letter}:\\`)}>
      <div className="flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 font-medium"><HardDrive size={13} style={{ color: "var(--fg2)" }} /> Local Disk ({d.letter}:)</span>
        <span className="tabular" style={{ color: "var(--fg2)" }}>{bytes(d.free)} free of {bytes(d.total, 0)}</span>
      </div>
      <Bar value={used} color={used > 0.92 ? "#ff453a" : "var(--accent)"} height={6} className="mt-1" />
    </button>
  );
}

// ---------- CPU / RAM / network ----------

function CpuTile() {
  const s = useTopic<SystemInfo>("system");
  const c = loadColor(s?.cpu ?? 0);
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="flex flex-col leading-none">
        <span className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "var(--fg2)" }}><Cpu size={11} /> CPU</span>
        <span className="tabular mt-1 text-[18px] font-semibold" style={{ color: c }}>{s?.cpu ?? 0}%</span>
      </div>
      <Sparkline values={s?.cpuHistory.slice(-30) ?? []} width={56} height={26} color={c} />
    </div>
  );
}

function RamTile() {
  const s = useTopic<SystemInfo>("system");
  const c = loadColor(s?.ram ?? 0);
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <Ring value={(s?.ram ?? 0) / 100} size={32} stroke={3.5} color={c}><MemoryStick size={13} /></Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[17px] font-semibold">{s?.ram ?? 0}%</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>{s ? `${bytes(s.ramUsed, 1)}` : "RAM"}</span>
      </div>
    </div>
  );
}

function NetworkTile() {
  const n = useTopic<NetInfo>("network");
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="grid h-[32px] w-[32px] place-items-center rounded-full" style={{ background: n?.connected ? "var(--accent)" : "var(--chip)", color: n?.connected ? "white" : "var(--fg2)" }}>
        {!n?.connected ? <WifiOff size={15} /> : n.kind === "ethernet" ? <EthernetIcon size={15} /> : <Wifi size={15} />}
      </div>
      <div className="flex flex-col gap-[3px] text-[11.5px] font-semibold leading-none">
        <span className="tabular flex items-center gap-0.5"><ArrowDown size={11} className="text-[#64d2ff]" />{speed(n?.down ?? 0)}</span>
        <span className="tabular flex items-center gap-0.5" style={{ color: "var(--fg2)" }}><ArrowUp size={11} className="text-[#bf5af2]" />{speed(n?.up ?? 0)}</span>
      </div>
      <Sparkline values={n?.history.slice(-30).map((h) => h.rx) ?? []} width={44} height={24} color="#64d2ff" />
    </div>
  );
}

// ---------- battery ----------

function BatteryShape({ level, charging, w = 30, h = 15 }: { level: number; charging: boolean; w?: number; h?: number }) {
  const c = charging ? "#30d158" : level <= 0.2 ? "#ff453a" : "var(--fg)";
  return (
    <svg width={w + 3} height={h} viewBox={`0 0 ${w + 3} ${h}`}>
      <rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={4} fill="none" stroke="var(--fg3)" strokeWidth={1.5} />
      <rect x={w + 0.5} y={h / 2 - 2.5} width={2} height={5} rx={1} fill="var(--fg3)" />
      <motion.rect x={2.5} y={2.5} height={h - 5} rx={2.5} fill={c} initial={false} animate={{ width: Math.max(2, (w - 5) * level) }} />
      {charging && <path d={`M${w / 2 + 1} 3 L${w / 2 - 3} ${h / 2 + 1} H${w / 2} L${w / 2 - 1} ${h - 3} L${w / 2 + 3} ${h / 2 - 1} H${w / 2} Z`} fill="white" stroke="black" strokeWidth={0.4} />}
    </svg>
  );
}

function BatteryTile() {
  const b = useBattery();
  if (!b) return <div className="flex h-full items-center px-3.5 text-[12px]" style={{ color: "var(--fg2)" }}>No battery</div>;
  return (
    <div className="flex h-full items-center gap-2.5 px-3.5">
      <BatteryShape level={b.level} charging={b.charging} />
      <div className="flex flex-col leading-none">
        <span className="tabular text-[16px] font-semibold">{Math.round(b.level * 100)}%</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>
          {b.charging ? (b.level >= 1 ? "Charged" : isFinite(b.chargingTime) && b.chargingTime > 0 ? `Full in ${duration(b.chargingTime)}` : "Charging") : isFinite(b.dischargingTime) ? `${duration(b.dischargingTime)} left` : "On battery"}
        </span>
      </div>
    </div>
  );
}

function BatteryCard(_: CardProps) {
  const b = useBattery();
  if (!b) return <Empty>This PC has no battery.</Empty>;
  return (
    <div>
      <CardHeader title="Battery" sub={b.charging ? "Plugged in" : "On battery power"} right={<button onClick={() => window.vyse.invoke("open:url", "ms-settings:batterysaver")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Power settings</button>} />
      <div className="flex items-center gap-4 rounded-[14px] p-4" style={{ background: "var(--chip)" }}>
        <BatteryShape level={b.level} charging={b.charging} w={70} h={34} />
        <div>
          <div className="tabular text-[30px] font-semibold leading-none">{Math.round(b.level * 100)}%</div>
          <div className="mt-1 text-[12px]" style={{ color: "var(--fg2)" }}>
            {b.charging ? (isFinite(b.chargingTime) && b.chargingTime > 0 ? `${duration(b.chargingTime)} until full` : "Charging") : isFinite(b.dischargingTime) ? `About ${duration(b.dischargingTime)} remaining` : "Estimating..."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- quick toggles ----------

function useToggles() {
  const radios = useTopic<Radio[]>("radios");
  const vol = useTopic<Volume>("volume");
  const theme = useTopic<{ dark: boolean }>("theme");
  const wifi = radios?.find((r) => r.kind === "wifi");
  const bt = radios?.find((r) => r.kind === "bluetooth");
  return {
    wifi,
    bt,
    vol,
    dark: theme?.dark ?? true,
    airplane: !!radios?.length && radios.every((r) => !r.on),
    setRadio: (kind: string, on: boolean) => void host("setRadio", { kind, on }),
    setAirplane: async (on: boolean) => {
      for (const r of radios ?? []) await host("setRadio", { kind: r.kind, on: !on });
    },
    mute: () => void host("setVolume", { muted: !vol?.muted }),
    setDark: (dark: boolean) => void host("setTheme", { dark }),
  };
}

function ToggleDot({ on, onClick, children, title, color = "var(--accent)" }: { on: boolean; onClick: () => void; children: React.ReactNode; title: string; color?: string }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        stop(e);
        onClick();
      }}
      className="grid h-[28px] w-[28px] place-items-center rounded-full transition-all active:scale-90"
      style={{ background: on ? color : "var(--chip)", color: on ? "white" : "var(--fg)" }}
    >
      {children}
    </button>
  );
}

interface Switches {
  keepAwake: boolean;
  mic: boolean | null;
  desktopIcons: boolean | null;
  energy: { on: boolean; available: boolean; always: boolean } | null;
  dnd: boolean | null;
  camera: boolean | null;
  hotspot: { on: boolean; clients: number; name?: string } | null;
  ethernet: boolean | null;
}

interface ToggleDef {
  id: string;
  label: string;
  on: boolean;
  /** this PC doesn't have it */
  missing?: boolean;
  sub: string;
  icon: (size: number) => React.ReactNode;
  color?: string;
  toggle: () => void;
}

const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

/** every switch Quick Toggles knows, in the order the card shows them */
function useToggleList(): ToggleDef[] {
  const t = useToggles();
  const sw = useTopic<Switches>("switches");
  const energyOn = !!sw?.energy && (sw.energy.on || sw.energy.always);
  return [
    { id: "wifi", label: "Wi-Fi", on: !!t.wifi?.on, missing: !t.wifi, sub: t.wifi ? (t.wifi.on ? "On" : "Off") : "No adapter", icon: (n) => (t.wifi?.on === false ? <WifiOff size={n} /> : <Wifi size={n} />), toggle: () => t.wifi && t.setRadio("wifi", !t.wifi.on) },
    { id: "bluetooth", label: "Bluetooth", on: !!t.bt?.on, missing: !t.bt, sub: t.bt ? (t.bt.on ? "On" : "Off") : "No adapter", icon: (n) => <Bluetooth size={n} />, toggle: () => t.bt && t.setRadio("bluetooth", !t.bt.on) },
    { id: "airplane", label: "Airplane", on: t.airplane, sub: t.airplane ? "On" : "Off", icon: (n) => <Plane size={n} />, color: "#ff9f0a", toggle: () => void t.setAirplane(!t.airplane) },
    { id: "dark", label: "Dark mode", on: t.dark, sub: t.dark ? "On" : "Off", icon: (n) => <Moon size={n} />, color: "#5e5ce6", toggle: () => t.setDark(!t.dark) },
    { id: "mute", label: "Mute", on: !!t.vol?.muted, sub: t.vol?.muted ? "Sound off" : "Sound on", icon: (n) => (t.vol?.muted ? <VolumeX size={n} /> : <Volume2 size={n} />), color: "#ff453a", toggle: t.mute },
    { id: "mic", label: "Microphone", on: sw?.mic === true, missing: sw?.mic == null, sub: sw?.mic == null ? "None found" : sw.mic ? "On" : "Muted", icon: (n) => (sw?.mic === false ? <MicOff size={n} /> : <Mic size={n} />), color: "#30d158", toggle: () => quiet(host("mic", { mute: !!sw?.mic })) },
    { id: "dnd", label: "Do not disturb", on: sw?.dnd === true, missing: sw?.dnd == null, sub: sw?.dnd ? "Notifications held" : "Off", icon: (n) => (sw?.dnd ? <BellOff size={n} /> : <Bell size={n} />), color: "#5e5ce6", toggle: () => quiet(host("dnd", { on: !sw?.dnd })) },
    { id: "energy", label: "Energy saver", on: energyOn, missing: !sw?.energy, sub: sw?.energy?.on ? "On" : sw?.energy?.always ? "On battery" : "Off", icon: (n) => <Leaf size={n} />, color: "#30d158", toggle: () => quiet(host("energySaver", { on: !energyOn })) },
    { id: "keepAwake", label: "Keep awake", on: !!sw?.keepAwake, sub: sw?.keepAwake ? "No sleep" : "Off", icon: (n) => <Coffee size={n} />, color: "#ff9f0a", toggle: () => quiet(host("keepAwake", { on: !sw?.keepAwake })) },
    { id: "hotspot", label: "Hotspot", on: !!sw?.hotspot?.on, missing: !sw?.hotspot, sub: sw?.hotspot ? (sw.hotspot.on ? `${sw.hotspot.clients} connected` : "Off") : "Not available", icon: (n) => <RadioTower size={n} />, color: "#ff9f0a", toggle: () => quiet(host("hotspot", { on: !sw?.hotspot?.on })) },
    // a cable can't be switched from here without admin rights; this one shows it and opens its settings
    { id: "ethernet", label: "Ethernet", on: sw?.ethernet === true, missing: sw?.ethernet == null, sub: sw?.ethernet == null ? "No adapter" : sw.ethernet ? "Connected" : "Unplugged", icon: (n) => <EthernetIcon size={n} />, toggle: () => void window.vyse.invoke("open:url", "ms-settings:network-ethernet") },
    { id: "camera", label: "Camera", on: sw?.camera === true, missing: sw?.camera == null, sub: sw?.camera == null ? "None found" : sw.camera ? "Apps can use it" : "Blocked", icon: (n) => (sw?.camera === false ? <CameraOff size={n} /> : <Camera size={n} />), color: "#64d2ff", toggle: () => quiet(host("camera", { on: !sw?.camera })) },
    { id: "desktopIcons", label: "Desktop icons", on: sw?.desktopIcons === true, missing: sw?.desktopIcons == null, sub: sw?.desktopIcons ? "Showing" : "Hidden", icon: (n) => <LayoutGrid size={n} />, color: "#64d2ff", toggle: () => quiet(host("desktopIcons", { show: !sw?.desktopIcons })) },
  ];
}

const TOGGLE_NAMES: [string, string][] = [
  ["wifi", "Wi-Fi"], ["bluetooth", "Bluetooth"], ["airplane", "Airplane"], ["dark", "Dark mode"], ["mute", "Mute"], ["mic", "Microphone"], ["dnd", "Do not disturb"],
  ["energy", "Energy saver"], ["keepAwake", "Keep awake"], ["hotspot", "Mobile hotspot"], ["ethernet", "Ethernet"], ["camera", "Camera"], ["desktopIcons", "Desktop icons"],
];

function toggleOnTile(id: string) {
  const cur = useStore.getState().settings.quickToggles;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  // kept in the card's order, whatever order they were picked in
  setSettings({ quickToggles: TOGGLE_NAMES.map(([k]) => k).filter((k) => next.includes(k)) });
}

function QuickTogglesTile() {
  const list = useToggleList();
  const ids = useStore((st) => st.settings.quickToggles);
  const shown = list.filter((t) => ids.includes(t.id));
  if (!shown.length) return <div className="flex h-full items-center gap-1.5 px-3 text-[11.5px]" style={{ color: "var(--fg2)" }}><SlidersHorizontal size={14} /> Toggles</div>;
  return (
    <div className="flex h-full items-center gap-1.5 px-2">
      {shown.map((t) => (
        <ToggleDot key={t.id} title={`${t.label}: ${t.sub}`} on={t.on && !t.missing} onClick={() => !t.missing && t.toggle()} color={t.color}>{t.icon(14)}</ToggleDot>
      ))}
    </div>
  );
}

function quickTogglesMenu(): MenuItem[] {
  const ids = useStore.getState().settings.quickToggles;
  return [{ label: "On the tile", disabled: true }, ...TOGGLE_NAMES.map(([id, label]) => ({ label, checked: ids.includes(id), onClick: () => toggleOnTile(id) }))];
}

function BigToggle({ on, onClick, icon, label, sub, color = "var(--accent)", disabled, picked }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string; color?: string; disabled?: boolean; picked?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className="relative flex items-center gap-2.5 rounded-[14px] p-2.5 text-left transition-colors disabled:opacity-40" style={{ background: "var(--chip)", outline: picked ? "1.5px solid var(--accent)" : undefined }}>
      <span className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full transition-colors" style={{ background: on ? color : "var(--track)", color: on ? "white" : "var(--fg)" }}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold">{label}</span>
        <span className="block truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>{sub}</span>
      </span>
      {picked !== undefined && (
        <span className="absolute right-2 top-2 grid h-[16px] w-[16px] place-items-center rounded-full" style={{ background: picked ? "var(--accent)" : "var(--track)", color: "white" }}>{picked && <Check size={10} strokeWidth={3} />}</span>
      )}
    </button>
  );
}

function QuickTogglesCard(_: CardProps) {
  const t = useToggles();
  const list = useToggleList();
  const ids = useStore((st) => st.settings.quickToggles);
  const [editing, setEditing] = useState(false);
  const bright = useTopic<number | null>("brightness");
  return (
    <div>
      {editing && <div className="mb-2 text-[11.5px]" style={{ color: "var(--fg2)" }}>Pick the switches that sit on the dock tile.</div>}
      <div className="grid grid-cols-2 gap-2">
        {list.map((x) => (
          <BigToggle
            key={x.id}
            on={x.on && !x.missing}
            disabled={!editing && x.missing}
            onClick={() => (editing ? toggleOnTile(x.id) : x.toggle())}
            icon={x.icon(15)}
            label={x.label}
            sub={x.sub}
            color={x.color}
            picked={editing ? ids.includes(x.id) : undefined}
          />
        ))}
        {!editing && <BigToggle on={false} onClick={() => void host("displayMode")} icon={<MonitorSmartphone size={15} />} label="Project" sub="Display mode" />}
      </div>
      <div className="mt-3 space-y-2 rounded-[14px] p-3" style={{ background: "var(--chip)" }}>
        <div className="text-[11.5px] font-semibold" style={{ color: "var(--fg2)" }}>Sound · {t.vol?.device ?? "..."}</div>
        <Slider value={t.vol?.muted ? 0 : t.vol?.volume ?? 0} onCommit={(v) => void host("setVolume", { volume: v, muted: false })} icon={t.vol?.muted ? <VolumeX size={14} /> : <Volume2 size={14} />} />
        {typeof bright === "number" && (
          <>
            <div className="pt-1 text-[11.5px] font-semibold" style={{ color: "var(--fg2)" }}>Display</div>
            <Slider value={bright} onCommit={(v) => void host("setBrightness", { level: v })} icon={<Sun size={14} />} />
          </>
        )}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {([["Edit tile", editing ? <Check key="e" size={15} /> : <Pencil key="e" size={15} />, async () => setEditing((e) => !e)], ["Quick Settings", <SlidersHorizontal key="q" size={15} />, () => host("quickSettings")], ["Notifications", <Bell key="n" size={15} />, () => host("actionCenter")], ["Settings", <Settings2 key="s" size={15} />, () => window.vyse.invoke("run", "settings")]] as const).map(([label, icon, fn]) => (
          <button key={label} onClick={() => void fn()} className="flex flex-col items-center gap-1 rounded-[12px] py-2 text-[10.5px] font-medium" style={{ background: "var(--chip)" }}>
            {icon}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- brightness / theme / language ----------

function BrightnessTile() {
  const b = useTopic<number | null>("brightness");
  return (
    <div className="flex h-full w-[150px] items-center gap-2 px-3" onClick={stop}>
      {typeof b === "number" ? (
        <Slider value={b} onCommit={(v) => void host("setBrightness", { level: v })} icon={<SunMedium size={14} />} height={26} />
      ) : (
        <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--fg2)" }}><SunMedium size={14} /> Laptop screens only</span>
      )}
    </div>
  );
}

function ThemeToggleTile() {
  const theme = useTopic<{ dark: boolean }>("theme");
  const dark = theme?.dark ?? true;
  return (
    <div className="flex h-full items-center px-2">
      <div className="relative flex h-[32px] w-[64px] items-center rounded-full p-[3px]" style={{ background: dark ? "#1c1c3a" : "#bfe3ff" }}>
        <motion.div className="grid h-[26px] w-[26px] place-items-center rounded-full shadow" style={{ background: dark ? "#e5e5ea" : "#ffd60a" }} initial={false} animate={{ x: dark ? 32 : 0, rotate: dark ? 0 : 180 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}>
          {dark ? <Moon size={14} className="text-[#3a3a6a]" /> : <Sun size={14} className="text-[#a65e00]" />}
        </motion.div>
      </div>
    </div>
  );
}

function LanguageTile() {
  const k = useTopic<KeyboardInfo>("keyboard");
  return (
    <div className="flex h-full items-center gap-2 px-3">
      <div className="grid h-[30px] min-w-[34px] place-items-center rounded-[9px] px-1.5 text-[12.5px] font-bold" style={{ background: "var(--chip)" }}>{k?.code ?? "--"}</div>
      <span className="max-w-[110px] truncate text-[11px]" style={{ color: "var(--fg2)" }}>{k?.name ?? "Keyboard"}</span>
    </div>
  );
}

function languageMenu(): MenuItem[] {
  const k = useStore.getState().topics.keyboard as KeyboardInfo | undefined;
  return (k?.all ?? []).map((l) => ({ label: l.name, checked: l.code === k?.code, onClick: () => void host("nextKeyboard", { id: l.id }).then(() => refreshTopic("keyboard")) }));
}

// ---------- progress ----------

function progressOf(kind: "day" | "month" | "year", now: number) {
  const d = new Date(now);
  let from: Date;
  let to: Date;
  if (kind === "day") {
    from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  } else if (kind === "month") {
    from = new Date(d.getFullYear(), d.getMonth(), 1);
    to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  } else {
    from = new Date(d.getFullYear(), 0, 1);
    to = new Date(d.getFullYear() + 1, 0, 1);
  }
  return (now - from.getTime()) / (to.getTime() - from.getTime());
}

const progressLabel = (kind: "day" | "month" | "year", now: number) => {
  const d = new Date(now);
  return kind === "day" ? "Today" : kind === "month" ? d.toLocaleDateString([], { month: "long" }) : String(d.getFullYear());
};

function progressTile(kind: "day" | "month" | "year", color: string) {
  return function ProgressTile() {
    const now = useNow(60_000);
    const p = progressOf(kind, now);
    return (
      <div className="flex h-full w-[140px] flex-col justify-center px-3.5 leading-none">
        <div className="flex justify-between text-[11px] font-semibold">
          <span>{progressLabel(kind, now)}</span>
          <span className="tabular" style={{ color }}>{Math.floor(p * 100)}%</span>
        </div>
        <Bar value={p} color={color} height={7} className="mt-2" />
      </div>
    );
  };
}

function ProgressCard(_: CardProps) {
  const now = useNow(60_000);
  const d = new Date(now);
  const yearDays = (new Date(d.getFullYear() + 1, 0, 1).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400_000;
  const dayOfYear = Math.floor((now - new Date(d.getFullYear(), 0, 1).getTime()) / 86400_000) + 1;
  const left = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - now;
  return (
    <div>
      <CardHeader title="Progress" sub={`Day ${dayOfYear} of ${yearDays}`} />
      <div className="space-y-3">
        {([["day", "#ff9f0a", `${duration(left / 1000)} left today`], ["month", "#30d158", `${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate()} days left`], ["year", "#0a84ff", `${yearDays - dayOfYear} days left`]] as const).map(([k, c, sub]) => (
          <div key={k}>
            <div className="flex justify-between text-[12.5px]">
              <span className="font-semibold">{progressLabel(k, now)}</span>
              <span className="tabular font-semibold" style={{ color: c }}>{(progressOf(k, now) * 100).toFixed(1)}%</span>
            </div>
            <Bar value={progressOf(k, now)} color={c} height={8} className="mt-1.5" />
            <div className="mt-1 text-[10.5px]" style={{ color: "var(--fg2)" }}>{sub}</div>
          </div>
        ))}
      </div>
      {/* the year as dots, one per day */}
      <div className="mt-4 grid gap-[3px]" style={{ gridTemplateColumns: "repeat(26, 1fr)" }}>
        {Array.from({ length: yearDays }, (_, i) => (
          <span key={i} className="aspect-square rounded-full" style={{ background: i < dayOfYear - 1 ? "var(--fg2)" : i === dayOfYear - 1 ? "#0a84ff" : "var(--track)" }} />
        ))}
      </div>
    </div>
  );
}

// ---------- storage / trash ----------

function StorageTile({ inst }: TileProps) {
  const st = useTopic<{ drives: Drive[] }>("storage");
  const want = (inst.config?.drive as string | undefined) ?? "C";
  const c = st?.drives.find((d) => d.letter === want) ?? st?.drives.find((d) => d.letter === "C") ?? st?.drives[0];
  const used = c ? 1 - c.free / c.total : 0;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <Ring value={used} size={32} stroke={3.5} color={used > 0.92 ? "#ff453a" : "var(--accent)"}><HardDrive size={13} /></Ring>
      <div className="flex flex-col leading-none">
        <span className="tabular text-[15px] font-semibold">{c ? bytes(c.free, 0) : "..."}</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>free on {c?.letter ?? "C"}:</span>
      </div>
    </div>
  );
}

function StorageCard(_: CardProps) {
  const st = useTopic<{ drives: Drive[] }>("storage");
  return (
    <div>
      <CardHeader title="Storage" right={<button onClick={() => window.vyse.invoke("open:url", "ms-settings:storagesense")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Clean up</button>} />
      <div className="space-y-3">{st?.drives.map((d) => <DriveRow key={d.letter} d={d} />) ?? <Empty>Reading drives...</Empty>}</div>
    </div>
  );
}

function storageMenu(inst: WidgetInstance): MenuItem[] {
  const drives = (useStore.getState().topics.storage as { drives: Drive[] } | undefined)?.drives ?? [];
  const want = (inst.config?.drive as string | undefined) ?? "C";
  return [{ label: "Drive on the tile", disabled: true }, ...drives.map((d) => ({ label: `${d.letter}:  ${bytes(d.free, 0)} free`, checked: d.letter === want, onClick: () => setWidgetConfig(inst.uid, { drive: d.letter }) }))];
}

// ---------- microphone ----------

interface MicInfo { volume: number; muted: boolean; device: string | null; id: string }
let micDevices: { id: string; name: string }[] = [];
const loadMicDevices = () => host<{ id: string; name: string }[]>("micDevices").then((l) => (micDevices = l ?? [])).catch(() => undefined);

function MicTile() {
  const m = useTopic<MicInfo | null>("mic");
  useEffect(() => void loadMicDevices(), [m?.id]);
  const live = !!m && !m.muted;
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="grid h-[30px] w-[30px] place-items-center rounded-full transition-colors" style={{ background: !m ? "var(--chip)" : live ? "#30d158" : "#ff453a", color: m ? "white" : "var(--fg2)" }}>
        {live || !m ? <Mic size={15} /> : <MicOff size={15} />}
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[12.5px] font-semibold">{!m ? "No mic" : live ? "Mic on" : "Muted"}</span>
        <span className="mt-1 max-w-[110px] truncate text-[10px]" style={{ color: "var(--fg2)" }}>{m ? `${m.volume}% · ${m.device ?? "Microphone"}` : "Plug one in"}</span>
      </div>
    </div>
  );
}

function micMenu(): MenuItem[] {
  const m = useStore.getState().topics.mic as MicInfo | null | undefined;
  const items: MenuItem[] = [];
  if (m) {
    items.push({ label: m.muted ? "Unmute" : "Mute", icon: m.muted ? <Mic size={14} /> : <MicOff size={14} />, onClick: () => quiet(host("setMic", { muted: !m.muted })) });
    items.push({ label: "Level", disabled: true });
    for (const v of [25, 50, 75, 100]) items.push({ label: `${v}%`, checked: Math.abs(m.volume - v) < 3, onClick: () => quiet(host("setMic", { volume: v })) });
  }
  if (micDevices.length > 1) {
    items.push({ separator: true }, { label: "Input", disabled: true });
    for (const d of micDevices) items.push({ label: d.name, checked: d.id === m?.id, onClick: () => quiet(host("setAudioDevice", { id: d.id })) });
  }
  items.push({ separator: true }, { label: "Sound settings", icon: <Settings2 size={14} />, onClick: () => void window.vyse.invoke("open:url", "ms-settings:sound") });
  return items;
}

// ---------- Bluetooth ----------

interface BtDevice { id: string; name: string; connected: boolean; battery: number | null; kind: string; le: boolean }

function BtIcon({ kind, size = 15 }: { kind: string; size?: number }) {
  switch (kind) {
    case "headset": return <Headphones size={size} />;
    case "speaker": return <Speaker size={size} />;
    case "phone": return <Smartphone size={size} />;
    case "keyboard": return <Keyboard size={size} />;
    case "mouse": return <Mouse size={size} />;
    case "gamepad": return <Gamepad2 size={size} />;
    case "watch": return <Watch size={size} />;
    case "computer": return <Laptop size={size} />;
    default: return <Bluetooth size={size} />;
  }
}

const batteryColor = (b: number) => (b <= 15 ? "#ff453a" : b <= 30 ? "#ff9f0a" : "#30d158");

function BluetoothTile() {
  const radios = useTopic<Radio[]>("radios");
  const list = useTopic<BtDevice[]>("bluetooth") ?? [];
  const radio = radios?.find((r) => r.kind === "bluetooth");
  const on = !!radio?.on;
  const connected = list.filter((d) => d.connected);
  // the connected device with a battery, lowest first: the one you'd want to charge
  const low = connected.filter((d) => d.battery != null).sort((a, b) => a.battery! - b.battery!)[0];
  return (
    <div className="flex h-full items-center gap-2.5 px-3">
      <div className="grid h-[30px] w-[30px] place-items-center rounded-full" style={{ background: on ? "var(--accent)" : "var(--chip)", color: on ? "white" : "var(--fg2)" }}>
        {on ? (low ? <BtIcon kind={low.kind} size={14} /> : <Bluetooth size={15} />) : <BluetoothOff size={15} />}
      </div>
      <div className="flex flex-col leading-none">
        <span className="max-w-[120px] truncate text-[12.5px] font-semibold">{!radio ? "Bluetooth" : !on ? "Off" : low ? low.name : connected.length ? connected[0].name : "On"}</span>
        <span className="tabular mt-1 text-[10px]" style={{ color: low ? batteryColor(low.battery!) : "var(--fg2)" }}>
          {!radio ? "No adapter" : !on ? "Bluetooth" : low ? `${low.battery}% battery` : connected.length ? `${connected.length} connected` : "Nothing connected"}
        </span>
      </div>
    </div>
  );
}

function BluetoothCard(_: CardProps) {
  const radios = useTopic<Radio[]>("radios");
  const list = useTopic<BtDevice[]>("bluetooth");
  const radio = radios?.find((r) => r.kind === "bluetooth");
  const on = !!radio?.on;
  return (
    <div>
      <CardHeader
        title="Bluetooth"
        sub={!radio ? "No Bluetooth adapter" : on ? `${list?.filter((d) => d.connected).length ?? 0} connected` : "Off"}
        right={
          <div className="flex items-center gap-2">
            <button onClick={() => void window.vyse.invoke("open:url", "ms-settings:bluetooth")} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Devices</button>
            {radio && <Toggle on={on} onChange={(v) => quiet(host("setRadio", { kind: "bluetooth", on: v }))} />}
          </div>
        }
      />
      {!list ? (
        <Empty>Looking for devices...</Empty>
      ) : !list.length ? (
        <Empty>No paired devices. Pair one in Windows' Bluetooth settings.</Empty>
      ) : (
        <div className="space-y-1.5">
          {list.map((d) => (
            <button key={d.id} onClick={() => void window.vyse.invoke("open:url", "ms-settings:bluetooth")} className="flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left" style={{ background: "var(--chip)", opacity: on ? 1 : 0.55 }}>
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full" style={{ background: d.connected && on ? "var(--accent)" : "var(--track)", color: d.connected && on ? "white" : "var(--fg)" }}>
                <BtIcon kind={d.kind} size={14} />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12.5px] font-semibold">{d.name}</span>
                <span className="block text-[10.5px]" style={{ color: "var(--fg2)" }}>{d.connected && on ? "Connected" : "Paired"}</span>
              </span>
              {d.battery != null && (
                <span className="flex w-[70px] shrink-0 flex-col items-end gap-1">
                  <span className="tabular text-[11.5px] font-semibold" style={{ color: batteryColor(d.battery) }}>{d.battery}%</span>
                  <Bar value={d.battery / 100} color={batteryColor(d.battery)} height={4} className="w-full" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10.5px]" style={{ color: "var(--fg3)" }}>Battery levels are the ones Windows reads from each device; not every device reports one.</div>
    </div>
  );
}

function TrashIcon({ full, size = 34 }: { full: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36">
      <defs>
        <linearGradient id="bin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9eef5" />
          <stop offset="1" stopColor="#aab4c3" />
        </linearGradient>
      </defs>
      <path d="M8 9h20l-2 22a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2Z" fill="url(#bin)" stroke="#7c8899" strokeWidth={0.8} />
      {[13, 18, 23].map((x) => <path key={x} d={`M${x} 13v16`} stroke="#7c8899" strokeWidth={1.2} strokeLinecap="round" />)}
      {full && (
        <g>
          <path d="M10 9c2-4 5-6 8-5s4 4 7 2 3 1 3 3Z" fill="#f2f2f2" stroke="#9aa5b5" strokeWidth={0.6} />
          <path d="M14 6l3 3M20 5l-2 4" stroke="#b8c1cd" strokeWidth={0.8} />
        </g>
      )}
      <rect x={6.5} y={7.5} width={23} height={2.5} rx={1.2} fill="#c9d1dc" stroke="#7c8899" strokeWidth={0.6} />
    </svg>
  );
}

function TrashTile() {
  const r = useTopic<{ items: number; bytes: number }>("recycle");
  const [hot, setHot] = useState(false);
  return (
    <div
      className="flex h-full items-center gap-2 px-2.5 transition-transform"
      style={{ transform: hot ? "scale(1.08)" : undefined }}
      onDragOver={(e) => {
        e.preventDefault();
        setHot(true);
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHot(false);
        const paths = [...e.dataTransfer.files].map((f) => window.vyse.pathOf(f)).filter(Boolean);
        if (paths.length) void window.vyse.invoke("files:trash", paths).then(() => refreshTopic("recycle"));
      }}
    >
      <TrashIcon full={(r?.items ?? 0) > 0} />
      <div className="flex flex-col pr-1 leading-none">
        <span className="text-[12px] font-semibold">Recycle Bin</span>
        <span className="mt-1 text-[10px]" style={{ color: "var(--fg2)" }}>{r?.items ? `${r.items} ${r.items === 1 ? "item" : "items"} · ${bytes(r.bytes)}` : "Empty"}</span>
      </div>
    </div>
  );
}

export const systemWidgets: WidgetDef[] = [
  { type: "systemStats", name: "System Stats", category: "System", description: "CPU, memory and network at a glance; the card shows history and every drive.", Tile: SystemStatsTile, Card: SystemCard, cardWidth: 380 },
  { type: "cpu", name: "CPU", category: "System", description: "Processor load right now, with the last minute as a line.", Tile: CpuTile, Card: SystemCard, cardWidth: 380 },
  { type: "ram", name: "Memory", category: "System", description: "How much RAM is in use.", Tile: RamTile, Card: SystemCard, cardWidth: 380 },
  { type: "network", name: "Network", category: "System", description: "Download and upload speed, live.", Tile: NetworkTile, Card: SystemCard, cardWidth: 380 },
  { type: "battery", name: "Battery", category: "System", description: "Charge, charging state and time left.", Tile: BatteryTile, Card: BatteryCard, cardWidth: 320 },
  { type: "quickToggles", name: "Quick Toggles", category: "System", description: "The switches you pick (Wi-Fi, Bluetooth, Do not disturb, energy saver, hotspot...) in one click; the card has them all plus sound and brightness.", Tile: QuickTogglesTile, Card: QuickTogglesCard, cardWidth: 340, menu: quickTogglesMenu },
  {
    type: "microphone", name: "Microphone", category: "System", description: "Your mic's state at a glance; click to mute or unmute, right-click for its level and input.", Tile: MicTile,
    action: () => {
      const m = useStore.getState().topics.mic as MicInfo | null | undefined;
      if (m) quiet(host("setMic", { muted: !m.muted }));
    },
    menu: micMenu,
  },
  { type: "bluetooth", name: "Bluetooth", category: "System", description: "Paired devices and the battery left in each; the radio's switch is in the card.", Tile: BluetoothTile, Card: BluetoothCard, cardWidth: 340 },
  { type: "brightness", name: "Brightness", category: "System", description: "A display brightness slider right on the bar.", Tile: BrightnessTile },
  {
    type: "themeToggle", name: "Light / Dark", category: "System", description: "Switch Windows between light and dark mode.", Tile: ThemeToggleTile,
    action: () => {
      const theme = useStore.getState().topics.theme as { dark: boolean } | undefined;
      void host("setTheme", { dark: !(theme?.dark ?? true) });
    },
  },
  {
    type: "language", name: "Keyboard Language", category: "System", description: "The input language, switched with a click.", Tile: LanguageTile,
    action: () => void host("nextKeyboard", { id: 0 }),
    menu: languageMenu,
  },
  { type: "dayProgress", name: "Day Progress", category: "System", description: "How much of today has gone.", Tile: progressTile("day", "#ff9f0a"), Card: ProgressCard, cardWidth: 340 },
  { type: "monthProgress", name: "Month Progress", category: "System", description: "How far through the month you are.", Tile: progressTile("month", "#30d158"), Card: ProgressCard, cardWidth: 340 },
  { type: "yearProgress", name: "Year Progress", category: "System", description: "This year so far, to the decimal.", Tile: progressTile("year", "#0a84ff"), Card: ProgressCard, cardWidth: 340 },
  { type: "storage", name: "Storage", category: "System", description: "Free space on the drive you pick (right-click the tile); the card lists every drive.", Tile: StorageTile, Card: StorageCard, cardWidth: 340, menu: storageMenu },
  {
    type: "trash", name: "Recycle Bin", category: "System", description: "Drop files on it to delete them; click to open, right-click to empty.", Tile: TrashTile,
    action: () => void window.vyse.invoke("run", "recycle"),
    menu: () => [
      { label: "Open Recycle Bin", icon: <Trash2 size={14} />, onClick: () => void window.vyse.invoke("run", "recycle") },
      { separator: true },
      { label: "Empty Recycle Bin", danger: true, onClick: () => void host("emptyRecycleBin") },
    ],
  },
];

