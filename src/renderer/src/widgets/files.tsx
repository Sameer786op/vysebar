// Apps and files: search, quick commands, downloads, screenshots and what you opened last.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Camera, Download, FileText, FolderOpen, Globe, LayoutGrid, Lock, LogOut, Monitor, Moon, Power, RotateCw,
  ScanText, Scissors, Search, Settings2, SquareTerminal, TerminalSquare,
} from "lucide-react";
import { bytes, relative } from "../lib/format";
import { host, useNow, useStore, useTopic } from "../lib/state";
import { CardHeader, Empty } from "../components/ui";
import type { CardProps, MenuItem, TileProps, WidgetDef } from "./types";

interface FileItem { name: string; path: string; size?: number; mtime: number; dir?: boolean; icon?: string; thumb?: string }
interface Files { downloads: FileItem[]; screenshots: FileItem[]; recent: FileItem[] }

const open = (p: string) => void window.vyse.invoke("open:path", p);
const reveal = (p: string) => void window.vyse.invoke("open:folder", p);
const drag = (e: React.DragEvent, f: FileItem) => {
  e.preventDefault();
  window.vyse.send("files:drag", f.path, f.thumb ?? f.icon);
};

function FileRow({ f, now }: { f: FileItem; now: number }) {
  return (
    <button draggable onDragStart={(e) => drag(e, f)} onClick={() => open(f.path)} onContextMenu={(e) => { e.preventDefault(); reveal(f.path); }} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--chip)]" title={f.path}>
      {f.icon ? <img src={f.icon} className="h-7 w-7 shrink-0" /> : <FileText size={22} className="shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{f.name}</div>
        <div className="text-[10.5px]" style={{ color: "var(--fg2)" }}>{relative(f.mtime - now)}{f.size != null && !f.dir ? ` · ${bytes(f.size)}` : ""}</div>
      </div>
    </button>
  );
}

// ---------- search ----------

function SearchTile() {
  return (
    <div className="flex h-full items-center gap-2 px-3.5" style={{ width: 170 }}>
      <Search size={15} style={{ color: "var(--fg2)" }} />
      <span className="text-[12.5px]" style={{ color: "var(--fg2)" }}>Search</span>
    </div>
  );
}

function SearchCard({ close }: CardProps) {
  const [q, setQ] = useState("");
  const [apps, setApps] = useState<{ name: string; id: string; icon?: string }[]>([]);
  const [sel, setSel] = useState(0);
  const files = useTopic<Files>("files");
  const icons = useRef(new Map<string, string>());
  const [, bump] = useState(0);
  useEffect(() => {
    void window.vyse.invoke<{ name: string; id: string }[]>("apps:start").then((l) => setApps(l ?? []));
  }, []);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const score = (name: string) => {
      const n = name.toLowerCase();
      if (n.startsWith(t)) return 0;
      if (n.split(/\s+/).some((w) => w.startsWith(t))) return 1;
      if (n.includes(t)) return 2;
      return 9;
    };
    const a = apps.map((x) => ({ kind: "app" as const, name: x.name, id: x.id, s: score(x.name) })).filter((x) => x.s < 9);
    const f = [...(files?.recent ?? []), ...(files?.downloads ?? [])].map((x) => ({ kind: "file" as const, name: x.name, id: x.path, icon: x.icon, s: score(x.name) + 1 })).filter((x) => x.s < 9);
    return [...a, ...f].sort((x, y) => x.s - y.s || x.name.length - y.name.length).slice(0, 8);
  }, [q, apps, files]);
  useEffect(() => {
    setSel(0);
    for (const r of results) {
      if (r.kind !== "app" || icons.current.has(r.id)) continue;
      icons.current.set(r.id, "");
      void window.vyse.invoke<string | undefined>("icon", { aumid: r.id }, 32).then((i) => {
        if (i) icons.current.set(r.id, i);
        bump((n) => n + 1);
      });
    }
  }, [results]);
  const run = (i: number) => {
    const r = results[i];
    if (r) {
      if (r.kind === "app") void window.vyse.invoke("pin:launch", { id: r.id, name: r.name, aumid: r.id });
      else open(r.id);
    } else if (q.trim()) {
      void window.vyse.invoke("open:url", `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`);
    }
    close();
  };
  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-[14px] px-3 py-2.5" style={{ background: "var(--chip)" }}>
        <Search size={17} style={{ color: "var(--fg2)" }} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            else if (e.key === "Enter") run(sel);
            else if (e.key === "Escape") close();
          }}
          placeholder="Apps, files and the web"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--fg3)]"
        />
      </div>
      <div className="mt-2 space-y-0.5">
        {results.map((r, i) => (
          <button key={r.kind + r.id} onMouseEnter={() => setSel(i)} onClick={() => run(i)} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left" style={{ background: i === sel ? "var(--accent)" : undefined, color: i === sel ? "white" : undefined }}>
            {(r.kind === "app" ? icons.current.get(r.id) : r.icon) ? <img src={(r.kind === "app" ? icons.current.get(r.id) : r.icon) as string} className="h-6 w-6" /> : <span className="h-6 w-6 rounded-md bg-[var(--chip)]" />}
            <span className="flex-1 truncate text-[13px]">{r.name}</span>
            <span className="text-[10.5px] opacity-70">{r.kind === "app" ? "App" : "File"}</span>
          </button>
        ))}
        {q.trim() && (
          <button onMouseEnter={() => setSel(results.length)} onClick={() => run(results.length)} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left" style={{ background: sel === results.length ? "var(--accent)" : undefined, color: sel === results.length ? "white" : undefined }}>
            <Globe size={20} className="mx-0.5" />
            <span className="flex-1 truncate text-[13px]">Search the web for “{q.trim()}”</span>
          </button>
        )}
        {!q.trim() && <div className="py-3 text-center text-[11.5px]" style={{ color: "var(--fg3)" }}>Type to find an app or a recent file</div>}
      </div>
    </div>
  );
}

// ---------- commands ----------

type Cmd = { label: string; icon: React.ReactNode; run: () => void; color: string; confirm?: boolean };
const COMMANDS: Cmd[] = [
  { label: "Lock", icon: <Lock size={16} />, run: () => void window.vyse.invoke("power", "lock"), color: "#0a84ff" },
  { label: "Sleep", icon: <Moon size={16} />, run: () => void window.vyse.invoke("power", "sleep"), color: "#5e5ce6" },
  { label: "Restart", icon: <RotateCw size={16} />, run: () => void window.vyse.invoke("power", "restart"), color: "#ff9f0a", confirm: true },
  { label: "Shut down", icon: <Power size={16} />, run: () => void window.vyse.invoke("power", "shutdown"), color: "#ff453a", confirm: true },
  { label: "Sign out", icon: <LogOut size={16} />, run: () => void window.vyse.invoke("power", "signout"), color: "#8e8e93", confirm: true },
  { label: "Task Manager", icon: <SquareTerminal size={16} />, run: () => void window.vyse.invoke("run", "taskmgr"), color: "#30d158" },
  { label: "Explorer", icon: <FolderOpen size={16} />, run: () => void window.vyse.invoke("run", "explorer"), color: "#ffd60a" },
  { label: "Settings", icon: <Settings2 size={16} />, run: () => void window.vyse.invoke("run", "settings"), color: "#8e8e93" },
  { label: "Snip", icon: <Scissors size={16} />, run: () => void host("snip"), color: "#ff375f" },
  { label: "Desktop", icon: <Monitor size={16} />, run: () => void host("showDesktop"), color: "#64d2ff" },
  { label: "Task View", icon: <LayoutGrid size={16} />, run: () => void host("taskView"), color: "#bf5af2" },
  { label: "Terminal", icon: <TerminalSquare size={16} />, run: () => void window.vyse.invoke("pin:launch", { id: "wt", name: "Terminal", aumid: "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App" }), color: "#3a3a3c" },
];

function CommandsTile() {
  return (
    <div className="flex h-full items-center gap-1 px-2">
      {COMMANDS.slice(0, 4).map((c) => (
        <span key={c.label} className="grid h-[30px] w-[30px] place-items-center rounded-[9px] text-white" style={{ background: c.color }}>{c.icon}</span>
      ))}
    </div>
  );
}

function CommandsCard({ close }: CardProps) {
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <div>
      <CardHeader title="Commands" sub={armed ? `Click ${armed} again to confirm` : "One click away"} />
      <div className="grid grid-cols-4 gap-2">
        {COMMANDS.map((c) => (
          <motion.button
            key={c.label}
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              if (c.confirm && armed !== c.label) return setArmed(c.label);
              c.run();
              close();
            }}
            className="flex flex-col items-center gap-1.5 rounded-[14px] py-2.5 text-[10.5px] font-medium"
            style={{ background: armed === c.label ? c.color : "var(--chip)", color: armed === c.label ? "white" : undefined }}
          >
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-white" style={{ background: c.color }}>{c.icon}</span>
            {armed === c.label ? "Confirm" : c.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ---------- downloads / screenshots / recent ----------

function DownloadsTile() {
  const f = useTopic<Files>("files");
  const now = useNow(60_000);
  const d = f?.downloads[0];
  return (
    <div className="flex h-full items-center gap-2.5 pl-2.5 pr-3.5" style={{ maxWidth: 220 }}>
      <div className="relative">
        {d?.icon ? <img src={d.icon} className="h-[30px] w-[30px]" draggable onDragStart={(e) => drag(e, d)} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-[#0a84ff] text-white"><Download size={16} /></span>}
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12px] font-semibold">{d?.name ?? "Downloads"}</span>
        <span className="text-[10.5px]" style={{ color: "var(--fg2)" }}>{d ? relative(d.mtime - now) : "Nothing yet"}</span>
      </div>
    </div>
  );
}

function DownloadsCard(_: CardProps) {
  const f = useTopic<Files>("files");
  const now = useNow(60_000);
  return (
    <div>
      <CardHeader title="Downloads" sub="Drag a file out to use it" right={<button onClick={() => f?.downloads[0] ? reveal(f.downloads[0].path) : undefined} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>Show folder</button>} />
      {f?.downloads.length ? f.downloads.map((x) => <FileRow key={x.path} f={x} now={now} />) : <Empty>No downloads yet</Empty>}
    </div>
  );
}

function ScreenshotsTile() {
  const f = useTopic<Files>("files");
  const s = f?.screenshots ?? [];
  return (
    <div className="flex h-full items-center gap-2 pl-[5px] pr-3">
      <div className="relative h-[36px] w-[54px]">
        {s.slice(0, 3).reverse().map((x, i, a) => (
          <img key={x.path} src={x.thumb} className="absolute h-[32px] w-[48px] rounded-[6px] border border-white/30 object-cover shadow" style={{ left: (a.length - 1 - i) * 3, top: (a.length - 1 - i) * 2, transform: `rotate(${(a.length - 1 - i) * -4}deg)` }} draggable onDragStart={(e) => drag(e, x)} />
        ))}
        {!s.length && <span className="grid h-[32px] w-[48px] place-items-center rounded-[6px] bg-[var(--chip)]"><Camera size={15} /></span>}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-semibold">Screenshots</span>
        <span className="text-[10.5px]" style={{ color: "var(--fg2)" }}>{s.length ? `${s.length} recent` : "None yet"}</span>
      </div>
    </div>
  );
}

/** reads the text in a screenshot with Windows' own OCR and puts it on the clipboard */
async function copyText(path: string): Promise<string> {
  const text = await window.vyse.invoke<string>("ocr:copy", path);
  return text ? `${text.split("\n").length} ${text.includes("\n") ? "lines" : "line"} copied` : "No text found";
}

function CopyText({ path }: { path: string }) {
  const [state, setState] = useState<string | null>(null);
  return (
    <span
      role="button"
      title="Copy the text in this screenshot"
      onClick={(e) => {
        e.stopPropagation();
        setState("Reading...");
        copyText(path)
          .then(setState, () => setState("Couldn't read it"))
          .finally(() => setTimeout(() => setState(null), 2200));
      }}
      className="flex items-center gap-1 rounded-full px-1.5 py-[1px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
      style={{ background: "var(--chip-hover)", color: "var(--fg)", opacity: state ? 1 : undefined }}
    >
      {state ? state : <><ScanText size={11} /> Copy text</>}
    </span>
  );
}

function screenshotsMenu(): MenuItem[] {
  const latest = (useStore.getState().topics.files as Files | undefined)?.screenshots[0];
  if (!latest) return [];
  return [
    {
      label: "Copy text from the latest",
      icon: <ScanText size={14} />,
      onClick: () =>
        void copyText(latest.path).then(
          (title) => window.vyse.invoke("toast", { id: `ocr-${Date.now()}`, title, body: "From your latest screenshot", icon: "todo", ttl: 3000 }),
          () => window.vyse.invoke("toast", { id: `ocr-${Date.now()}`, title: "Couldn't read that screenshot", ttl: 3000 }),
        ),
    },
  ];
}

function ScreenshotsCard(_: CardProps) {
  const f = useTopic<Files>("files");
  const now = useNow(60_000);
  const s = f?.screenshots ?? [];
  return (
    <div>
      <CardHeader title="Screenshots" sub="Click to open, drag to share" right={<button onClick={() => void host("snip")} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-white" style={{ background: "var(--accent)" }}><Scissors size={12} /> New</button>} />
      {s.length ? (
        <div className="grid grid-cols-2 gap-2">
          {s.map((x) => (
            <button key={x.path} draggable onDragStart={(e) => drag(e, x)} onClick={() => open(x.path)} onContextMenu={(e) => { e.preventDefault(); reveal(x.path); }} className="group relative overflow-hidden rounded-[12px] text-left" style={{ background: "var(--chip)" }}>
              <img src={x.thumb} className="aspect-[16/10] w-full object-cover transition-transform group-hover:scale-105" />
              <div className="flex items-center justify-between px-2 py-1 text-[10.5px]" style={{ color: "var(--fg2)" }}>
                <span>{relative(x.mtime - now)}</span>
                <CopyText path={x.path} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty>Screenshots you take with Win+Shift+S or PrtScn show up here</Empty>
      )}
    </div>
  );
}

function RecentTile() {
  const f = useTopic<Files>("files");
  const r = f?.recent ?? [];
  return (
    <div className="flex h-full items-center gap-2 pl-2.5 pr-3.5">
      <div className="flex -space-x-2">
        {r.slice(0, 3).map((x) => (x.icon ? <img key={x.path} src={x.icon} className="h-[26px] w-[26px] drop-shadow" /> : null))}
        {!r.length && <FileText size={20} />}
      </div>
      <div className="flex min-w-0 max-w-[130px] flex-col leading-tight">
        <span className="text-[12px] font-semibold">Recent</span>
        <span className="truncate text-[10.5px]" style={{ color: "var(--fg2)" }}>{r[0]?.name ?? "Nothing opened yet"}</span>
      </div>
    </div>
  );
}

function RecentCard(_: CardProps) {
  const f = useTopic<Files>("files");
  const now = useNow(60_000);
  return (
    <div>
      <CardHeader title="Recently Opened" />
      {f?.recent.length ? f.recent.map((x) => <FileRow key={x.path} f={x} now={now} />) : <Empty>Files you open show up here</Empty>}
    </div>
  );
}

// ---------- one-click tiles ----------

function iconTile(icon: React.ReactNode, label: string, color: string) {
  return function IconTile({ preview }: TileProps) {
    void preview;
    return (
      <div className="flex h-full items-center gap-2 pl-[6px] pr-3">
        <span className="grid h-[32px] w-[32px] place-items-center rounded-[10px] text-white" style={{ background: color }}>{icon}</span>
        <span className="text-[12px] font-semibold">{label}</span>
      </div>
    );
  };
}

export const fileWidgets: WidgetDef[] = [
  { type: "search", name: "Search", category: "Apps & Files", description: "Find any app or recent file, or search the web.", Tile: SearchTile, Card: SearchCard, cardWidth: 420, cardFocus: true },
  { type: "commands", name: "Commands", category: "Apps & Files", description: "Lock, sleep, restart, Task Manager and more in one grid.", Tile: CommandsTile, Card: CommandsCard, cardWidth: 340 },
  { type: "downloads", name: "Downloads", category: "Apps & Files", description: "Your latest download; drag files straight out of the card.", Tile: DownloadsTile, Card: DownloadsCard, cardWidth: 340 },
  { type: "recentScreenshots", name: "Recent Screenshots", category: "Apps & Files", description: "Your last screenshots, ready to drag into a chat; copy the text out of any of them.", Tile: ScreenshotsTile, Card: ScreenshotsCard, cardWidth: 380, menu: screenshotsMenu },
  { type: "recentlyOpened", name: "Recently Opened", category: "Apps & Files", description: "The files you opened last.", Tile: RecentTile, Card: RecentCard, cardWidth: 340 },
  { type: "screenshotCapture", name: "Screenshot", category: "Apps & Files", description: "Start a screen snip with one click.", Tile: iconTile(<Camera size={16} />, "Snip", "#ff375f"), action: () => void host("snip") },
  { type: "showDesktop", name: "Show Desktop", category: "Apps & Files", description: "Minimise everything; click again to bring it back.", Tile: iconTile(<Monitor size={16} />, "Desktop", "#64d2ff"), action: () => void host("showDesktop") },
  { type: "taskView", name: "Task View", category: "Apps & Files", description: "Every open window and desktop at once.", Tile: iconTile(<LayoutGrid size={16} />, "Task View", "#bf5af2"), action: () => void host("taskView") },
];
