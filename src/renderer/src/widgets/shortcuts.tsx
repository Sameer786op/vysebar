// Any app or folder as a widget of its own, and the stack a folder opens into.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ExternalLink, FileText, Folder, FolderOpen } from "lucide-react";
import type { AppItem, Pin, WidgetInstance } from "@shared/types";
import { bytes, relative } from "../lib/format";
import { useNow, useStore, useTopic } from "../lib/state";
import { CardHeader, Empty } from "../components/ui";
import type { CardProps, MenuItem, TileProps, WidgetDef } from "./types";

const vyse = window.vyse;

// icons are asked for once per target and kept for the session
const iconCache = new Map<string, Promise<string | undefined>>();
export function useIcon(target: Pin | string | null | undefined, size = 64): string | undefined {
  const key = !target ? "" : typeof target === "string" ? target : `${target.aumid ?? ""}|${target.path ?? ""}|${target.exe ?? ""}`;
  const [icon, setIcon] = useState<string | undefined>();
  useEffect(() => {
    if (!key) return;
    let p = iconCache.get(`${key}@${size}`);
    if (!p) {
      p = vyse.invoke<string | undefined>("icon", target, size).catch(() => undefined);
      iconCache.set(`${key}@${size}`, p);
    }
    let off = false;
    void p.then((i) => !off && setIcon(i));
    return () => {
      off = true;
    };
  }, [key, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return icon;
}

// ---------- an app ----------

const norm = (s?: string | null) => (s ?? "").toLowerCase();

/** the running app the shortcut stands for, matched the way the dock matches pins */
function runningFor(pin: Pin, apps: AppItem[] | undefined): AppItem | undefined {
  return apps?.find((a) => a.windows.some((w) => (pin.aumid && norm(w.aumid) === norm(pin.aumid)) || (pin.exe && norm(w.exe) === norm(pin.exe))));
}

function AppShortcutTile({ inst }: TileProps) {
  const pin = inst.config?.pin as Pin | undefined;
  const icon = useIcon(pin);
  const apps = useTopic<AppItem[]>("apps");
  const running = pin ? runningFor(pin, apps) : undefined;
  return (
    <div className="flex h-full items-center gap-2 pl-[7px] pr-3">
      <span className="relative grid h-[32px] w-[32px] shrink-0 place-items-center">
        {icon ? <img src={icon} draggable={false} className="h-[28px] w-[28px] drop-shadow-[0_1px_2px_rgb(0_0_0/0.22)]" /> : <span className="h-[26px] w-[26px] rounded-[25%]" style={{ background: "var(--chip)" }} />}
        {running && <span className="absolute -bottom-[3px] h-[3px] w-[10px] rounded-full" style={{ background: running.active ? "var(--accent)" : "var(--fg2)" }} />}
      </span>
      <span className="max-w-[120px] truncate text-[12px] font-semibold">{pin?.name ?? "App"}</span>
    </div>
  );
}

function openApp(inst: WidgetInstance) {
  const pin = inst.config?.pin as Pin | undefined;
  if (!pin) return;
  const running = runningFor(pin, useStore.getState().topics.apps as AppItem[] | undefined);
  // running: up (or down again, like a taskbar button); otherwise it starts
  if (running?.windows[0]) void vyse.invoke("win:activate", running.windows[0].hwnd, true);
  else void vyse.invoke("pin:launch", pin);
}

function appMenu(inst: WidgetInstance): MenuItem[] {
  const pin = inst.config?.pin as Pin | undefined;
  if (!pin) return [];
  return [
    { label: pin.name, disabled: true },
    { label: "New window", icon: <ExternalLink size={14} />, onClick: () => void vyse.invoke("pin:launch", pin) },
  ];
}

// ---------- a folder ----------

interface Entry { name: string; path: string; dir: boolean; mtime: number; size: number }

function EntryIcon({ e }: { e: Entry }) {
  const icon = useIcon(e.path, 48);
  if (icon) return <img src={icon} draggable={false} className="h-[38px] w-[38px] drop-shadow-[0_1px_2px_rgb(0_0_0/0.2)]" />;
  return e.dir ? <Folder size={32} style={{ color: "#64d2ff" }} /> : <FileText size={30} style={{ color: "var(--fg2)" }} />;
}

/** a folder fanned out over the dock: newest first, folders inside open in place */
export function FolderStack({ path, name }: { path: string; name: string }) {
  const [trail, setTrail] = useState<{ path: string; name: string }[]>([{ path, name }]);
  const here = trail[trail.length - 1];
  const [items, setItems] = useState<Entry[] | null | undefined>(undefined);
  const now = useNow(60_000);
  useEffect(() => {
    let off = false;
    setItems(undefined);
    void vyse.invoke<Entry[] | null>("folder:list", here.path).then((l) => !off && setItems(l));
    return () => {
      off = true;
    };
  }, [here.path]);
  return (
    <div>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            {trail.length > 1 && (
              <button onClick={() => setTrail((t) => t.slice(0, -1))} className="grid h-6 w-6 place-items-center rounded-full" style={{ background: "var(--chip)" }}>
                <ArrowLeft size={13} />
              </button>
            )}
            <span className="truncate">{here.name}</span>
          </span>
        }
        sub={items ? `${items.length} ${items.length === 1 ? "item" : "items"}` : undefined}
        right={
          <button onClick={() => void vyse.invoke("open:path", here.path)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--chip)" }}>
            <FolderOpen size={12} /> Open
          </button>
        }
      />
      {items === undefined ? (
        <Empty>Reading the folder...</Empty>
      ) : items === null ? (
        <Empty>This folder can't be read. It may have been moved or deleted.</Empty>
      ) : !items.length ? (
        <Empty>Nothing in here yet</Empty>
      ) : (
        <div className="thin-scroll -mx-1 grid max-h-[360px] grid-cols-4 gap-1 overflow-y-auto px-1">
          {items.slice(0, 120).map((e, i) => (
            <motion.button
              key={e.path}
              initial={{ opacity: 0, y: 10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 32, delay: Math.min(i, 16) * 0.018 }}
              draggable
              onDragStart={(ev) => {
                ev.preventDefault();
                vyse.send("files:drag", e.path);
              }}
              onClick={() => (e.dir ? setTrail((t) => [...t, { path: e.path, name: e.name }]) : void vyse.invoke("open:path", e.path))}
              onContextMenu={(ev) => {
                ev.preventDefault();
                void vyse.invoke("open:folder", e.path);
              }}
              title={`${e.name}\n${relative(e.mtime - now)}${e.dir ? "" : ` · ${bytes(e.size)}`}`}
              className="flex flex-col items-center gap-1 rounded-[12px] px-1 py-2 hover:bg-[var(--chip)]"
            >
              <EntryIcon e={e} />
              <span className="line-clamp-2 w-full break-all text-center text-[10.5px] leading-tight">{e.name}</span>
            </motion.button>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10.5px]" style={{ color: "var(--fg3)" }}>Drag a file out, right-click to show it in Explorer.</div>
    </div>
  );
}

function FolderTile({ inst }: TileProps) {
  const path = inst.config?.path as string | undefined;
  const icon = useIcon(path ?? null);
  return (
    <div className="flex h-full items-center gap-2 pl-[7px] pr-3">
      {icon ? <img src={icon} draggable={false} className="h-[30px] w-[30px]" /> : <Folder size={24} style={{ color: "#64d2ff" }} />}
      <span className="max-w-[120px] truncate text-[12px] font-semibold">{(inst.config?.name as string | undefined) ?? "Folder"}</span>
    </div>
  );
}

function FolderCard({ inst }: CardProps) {
  const path = inst.config?.path as string | undefined;
  if (!path) return <Empty>No folder chosen</Empty>;
  return <FolderStack path={path} name={(inst.config?.name as string | undefined) ?? path} />;
}

export const shortcutWidgets: WidgetDef[] = [
  {
    type: "app", name: "App", category: "Apps & Files", description: "One app as a tile of its own.", Tile: AppShortcutTile,
    action: openApp, menu: appMenu,
    // added from the picker's list of your apps, one tile per app
    hidden: true,
  },
  {
    type: "folder", name: "Folder", category: "Apps & Files", description: "A folder you pick, opening as a stack of what's inside. Add as many as you like.", Tile: FolderTile, Card: FolderCard, cardWidth: 400,
    create: async () => {
      const f = await vyse.invoke<{ path: string; name: string } | null>("dialog:folder");
      return f ? { path: f.path, name: f.name } : null;
    },
    menu: (inst) => [{ label: "Open in Explorer", icon: <FolderOpen size={14} />, onClick: () => void vyse.invoke("open:path", inst.config?.path) }],
  },
];
