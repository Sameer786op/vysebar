// The taskbar part of the dock: Start, pinned apps, groups and whatever else is running.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useAnimationControls } from "motion/react";
import { AppWindow, ArrowUpRight, ExternalLink, FileText, Folder, FolderPlus, Pin as PinIcon, PinOff, Skull, SquarePlus, X } from "lucide-react";
import type { AppItem, GoogleProfile, Pin, WinInfo } from "@shared/types";
import { host, setSettings, useCommitted, useSettings, useStore, useTopic } from "../lib/state";
import { VyseLogo, WindowsLogo } from "../components/icons";
import type { MenuItem, TileProps, WidgetDef } from "../widgets/types";
import { useDock } from "../widgets/types";

const vyse = window.vyse;

// File Explorer's right-click menu lists the Quick access folders; the last list shows at once
// while a fresh one is read
type QuickFolder = { name: string; path: string };
let quickAccess: QuickFolder[] | null = null;
const loadQuickAccess = () =>
  host<QuickFolder[] | null>("quickAccess")
    .then((l) => (quickAccess = l ?? []))
    .catch(() => (quickAccess ??= []));
// a pin imported from the taskbar names Explorer by its app id and shortcut, one made here by its exe
const isExplorer = (app: AppItem) =>
  app.pin?.aumid === "Microsoft.Windows.Explorer" ||
  /(^|\\)(explorer\.exe|File Explorer\.lnk)$/i.test(app.pin?.exe ?? app.pin?.path ?? app.windows[0]?.exe ?? "");

// an app's recent files, the list its taskbar jump list shows; as with Quick access, the last
// list shows at once while a fresh one is read
// and, like the taskbar's jump list, the app's own lists and Tasks ("New Incognito window")
type JumpEntry = { title: string; list: number; index: number } | { separator: true };
type RecentList = {
  appId: string;
  items: { name: string; path: string; folder: boolean }[];
  listId?: string | null;
  lists?: { name: string; list: number; items: JumpEntry[] }[];
};
const recentFiles = new Map<string, RecentList | null>();
const exeOf = (app: AppItem) =>
  app.windows[0]?.exe ?? app.pin?.exe ?? (app.pin?.path && /\.exe$/i.test(app.pin.path) ? app.pin.path : null);
const loadRecent = (app: AppItem) =>
  host<RecentList | null>("jumpList", {
    ids: [app.pin?.aumid, ...app.windows.map((w) => w.aumid)].filter(Boolean),
    exe: exeOf(app),
    lnk: app.pin?.path && /\.lnk$/i.test(app.pin.path) ? app.pin.path : null,
  })
    .then((r) => void recentFiles.set(app.key, r))
    .catch(() => void (recentFiles.has(app.key) || recentFiles.set(app.key, null)));

const activate = (w: WinInfo, toggle = true) => vyse.invoke("win:activate", w.hwnd, toggle);
const launch = (pin: Pin) => vyse.invoke("pin:launch", pin);

// ---------- Start ----------

function StartButton({ onDragStart }: { onDragStart?: (e: React.PointerEvent) => void }) {
  const s = useSettings();
  const { tile, justDragged } = useDock();
  const [down, setDown] = useState(false);
  const profile = useTopic<GoogleProfile | null>(s.startTile === "google" ? "profile" : null);
  const photo = s.startTile === "google" ? profile?.photo : null;
  return (
    <motion.button
      data-hit
      data-glass="tile"
      title={photo && profile ? `Start · ${profile.givenName}` : "Start"}
      onPointerDown={(e) => {
        setDown(true);
        onDragStart?.(e);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onClick={() => !justDragged() && void host("start")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void host("winx");
      }}
      animate={{ scale: down ? 0.9 : 1 }}
      whileHover={{ scale: 1.06 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      className="grid shrink-0 place-items-center overflow-hidden"
      style={{
        width: tile,
        height: tile,
        borderRadius: tile * 0.28,
        background: s.startTile === "custom" && s.startImage ? `center/cover url(${s.startImage})` : photo ? `center/cover url(${photo})` : "var(--tile)",
      }}
    >
      {(s.startTile === "windows" || (s.startTile === "google" && !photo)) && <WindowsLogo size={tile * 0.46} />}
      {s.startTile === "vyse" && <VyseLogo size={tile * 0.6} />}
    </motion.button>
  );
}

// ---------- one app ----------

function Indicator({ app, edge }: { app: AppItem; edge: "top" | "bottom" }) {
  const n = app.windows.length;
  if (!n) return null;
  return (
    <motion.span
      layout
      className={`absolute left-1/2 h-[4px] -translate-x-1/2 rounded-full ${app.flashing ? "animate-pulse" : ""}`}
      style={{ [edge === "bottom" ? "bottom" : "top"]: 1, background: app.flashing ? "#ff9f0a" : app.active ? "var(--accent)" : "var(--fg2)" }}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: app.active ? 16 : n > 1 ? 9 : 5, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    />
  );
}

function GroupIcon({ app, size }: { app: AppItem; size: number }) {
  let icons: string[] = [];
  try {
    icons = JSON.parse(app.icon ?? "[]");
  } catch {
    icons = [];
  }
  return (
    <div className="grid grid-cols-2 gap-[2px] rounded-[28%] p-[4px]" style={{ width: size, height: size, background: "var(--chip)" }}>
      {[0, 1, 2, 3].map((i) => (icons[i] ? <img key={i} src={icons[i]} className="h-full w-full object-contain" draggable={false} /> : <span key={i} />))}
    </div>
  );
}

function Previews({ app, close }: { app: AppItem; close: () => void }) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [wins, setWins] = useState(app.windows);
  // peek: rest on a preview and its window comes up full size; slide to the next preview and it
  // switches straight away; leave and everything goes back
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const peeking = useRef(false);
  const stopPeek = () => {
    clearTimeout(peekTimer.current);
    if (!peeking.current) return;
    peeking.current = false;
    vyse.send("dock:peek", null);
  };
  const peekAt = (w: WinInfo) => {
    clearTimeout(peekTimer.current);
    if (!useStore.getState().settings.peek || w.minimized) return stopPeek();
    peekTimer.current = setTimeout(() => {
      peeking.current = true;
      vyse.send("dock:peek", w.hwnd);
    }, peeking.current ? 0 : 400);
  };
  const leavePeek = () => {
    clearTimeout(peekTimer.current);
    if (peeking.current) peekTimer.current = setTimeout(stopPeek, 140);
  };
  useEffect(() => stopPeek, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let off = false;
    const load = () => vyse.invoke<Record<number, string>>("win:thumbs", wins.map((w) => w.hwnd)).then((t) => !off && setThumbs(t ?? {}));
    void load();
    const t = setInterval(load, 1500);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [wins]);
  const closeWin = (w: WinInfo) => {
    stopPeek();
    void host("close", { hwnd: w.hwnd });
    setWins((l) => l.filter((x) => x.hwnd !== w.hwnd));
    if (wins.length <= 1) close();
  };
  return (
    <div className="flex gap-2">
      {wins.map((w) => (
        <motion.button
          key={w.hwnd}
          layout
          onClick={() => {
            stopPeek();
            void activate(w, false);
            close();
          }}
          onMouseEnter={() => peekAt(w)}
          onMouseLeave={leavePeek}
          // middle-click closes the window, as on the taskbar's thumbnails
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            closeWin(w);
          }}
          className="group relative flex w-[188px] flex-col overflow-hidden rounded-[14px] p-1.5 text-left transition-colors hover:bg-[var(--chip)]"
          style={{ outline: w.active ? "1.5px solid var(--accent)" : undefined }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
            {app.icon && !app.key.startsWith("group:") && <img src={app.icon} className="h-4 w-4" />}
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{w.title}</span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                closeWin(w);
              }}
              className="grid h-5 w-5 place-items-center rounded-full opacity-0 transition-opacity hover:bg-[#ff453a] hover:text-white group-hover:opacity-100"
            >
              <X size={11} />
            </span>
          </div>
          <div className="grid h-[104px] place-items-center overflow-hidden rounded-[9px]" style={{ background: "var(--chip)" }}>
            {thumbs[w.hwnd] ? <img src={thumbs[w.hwnd]} className="max-h-full max-w-full object-contain" /> : w.minimized ? <span className="text-[10.5px]" style={{ color: "var(--fg3)" }}>Minimised</span> : <AppWindow size={20} style={{ color: "var(--fg3)" }} />}
          </div>
        </motion.button>
      ))}
    </div>
  );
}

function GroupCard({ app, close }: { app: AppItem; close: () => void }) {
  const s = useSettings();
  const group = app.pin!.group!;
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [name, setName, flushName] = useCommitted(group.name, (n) => save(group.items, n));
  useEffect(() => {
    for (const p of group.items) void vyse.invoke<string | undefined>("icon", p, 64).then((i) => i && setIcons((m) => ({ ...m, [p.id]: i })));
  }, [group.items]);
  const save = (items: Pin[], newName = name) => {
    const pins = s.pins.flatMap((p) => {
      if (p.id !== app.pin!.id) return [p];
      if (items.length <= 1) return items; // one app left is no longer a group
      return [{ ...p, name: newName, group: { name: newName, items } }];
    });
    setSettings({ pins });
  };
  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={flushName} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mb-3 w-full bg-transparent text-center text-[15px] font-semibold outline-none" />
      <div className="grid grid-cols-4 gap-x-2 gap-y-3">
        {group.items.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              void launch(p);
              close();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              save(group.items.filter((x) => x.id !== p.id));
              setSettings({ pins: [...useStore.getState().settings.pins, p] });
            }}
            title="Right-click to take it out of the group"
            className="flex flex-col items-center gap-1 rounded-[12px] p-1.5 hover:bg-[var(--chip)]"
          >
            {icons[p.id] ? <img src={icons[p.id]} className="h-11 w-11" /> : <span className="h-11 w-11 rounded-[12px] bg-[var(--chip)]" />}
            <span className="w-full truncate text-center text-[10.5px]">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AppIcon({ app, onLaunch, dragging }: { app: AppItem; onLaunch?: () => void; dragging?: boolean }) {
  const s = useSettings();
  const dock = useDock();
  const ref = useRef<HTMLDivElement>(null);
  const bounce = useAnimationControls();
  const [hover, setHover] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isGroup = app.key.startsWith("group:");
  const size = dock.tile;
  const iconSize = Math.round(size * 0.62);
  const previewWidth = Math.min(4, app.windows.length) * 196 + 12;

  const openPreviews = (hoverOnly: boolean) => {
    if (!ref.current) return;
    dock.openCard(app.key, ref.current, <Previews app={app} close={dock.closeCard} />, { width: previewWidth, hover: hoverOnly, padding: 6 });
  };

  const click = (e: React.MouseEvent) => {
    if (dock.justDragged()) return;
    clearTimeout(hoverTimer.current);
    if (isGroup) {
      if (dock.cardUid === app.key) return dock.closeCard();
      return ref.current && dock.openCard(app.key, ref.current, <GroupCard app={app} close={dock.closeCard} />, { width: 330 });
    }
    const wins = app.windows;
    if (!wins.length || e.shiftKey) {
      void bounce.start({ y: [0, -12, 0, -5, 0], transition: { duration: 0.7, ease: "easeOut" } });
      if (app.pin) void launch(app.pin);
      onLaunch?.();
      return;
    }
    if (wins.length === 1) {
      dock.closeCard();
      return void activate(wins[0]);
    }
    // Ctrl+click steps through the app's windows, as on the taskbar
    if (e.ctrlKey) {
      dock.closeCard();
      return keyAction("open");
    }
    // several windows: the previews pick one
    if (dock.cardUid === app.key && !useStore.getState().pickerOpen) return dock.closeCard();
    openPreviews(false);
  };

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    // the dock's own menu is for its empty space, not for an app
    e.stopPropagation();
    void openMenuAt({ x: e.clientX, y: e.clientY });
  };

  const openMenuAt = async (at: { x: number; y: number }) => {
    clearTimeout(hoverTimer.current);
    const folders: MenuItem[] = [];
    if (!isGroup && isExplorer(app)) {
      const fresh = loadQuickAccess();
      if (!quickAccess) await Promise.race([fresh, new Promise((r) => setTimeout(r, 700))]);
      for (const f of (quickAccess ?? []).slice(0, 10)) folders.push({ label: f.name, icon: <Folder size={14} />, onClick: () => void vyse.invoke("open:path", f.path) });
      if (folders.length) folders.unshift({ separator: true }, { label: "Quick access", disabled: true });
    } else if (!isGroup) {
      const fresh = loadRecent(app);
      if (!recentFiles.has(app.key)) await Promise.race([fresh, new Promise((r) => setTimeout(r, 700))]);
      const r = recentFiles.get(app.key);
      const exe = exeOf(app);
      for (const f of (r?.items ?? []).slice(0, 8)) {
        folders.push({ label: f.name, icon: f.folder ? <Folder size={14} /> : <FileText size={14} />, onClick: () => void host("jumpOpen", { path: f.path, appId: r!.appId, exe }) });
      }
      if (folders.length) folders.unshift({ separator: true }, { label: "Recent", disabled: true });
      // the app's own lists, then its Tasks, in the order the taskbar shows them
      for (const l of r?.listId ? (r.lists ?? []) : []) {
        const entries = l.items.slice(0, l.list < 0 ? 12 : 6);
        if (!entries.some((x) => !("separator" in x))) continue;
        folders.push({ separator: true }, { label: l.name || "More", disabled: true });
        for (const x of entries) {
          if ("separator" in x) folders.push({ separator: true });
          else folders.push({ label: x.title, icon: <ArrowUpRight size={14} />, onClick: () => void host("jumpTask", { listId: r!.listId, list: x.list, index: x.index }) });
        }
      }
    }
    const items: MenuItem[] = [];
    if (isGroup) {
      items.push({ label: "Open group", icon: <Folder size={14} />, onClick: () => ref.current && dock.openCard(app.key, ref.current, <GroupCard app={app} close={dock.closeCard} />, { width: 330 }) });
      items.push({ label: "Ungroup", icon: <SquarePlus size={14} />, onClick: () => setSettings({ pins: s.pins.flatMap((p) => (p.id === app.pin!.id ? p.group!.items : [p])) }) });
    } else {
      items.push({ label: app.name, disabled: true });
      items.push({ separator: true });
      items.push({
        label: app.windows.length ? "New window" : "Open",
        icon: <ExternalLink size={14} />,
        onClick: () => (app.pin ? void launch(app.pin) : app.windows[0] && void vyse.invoke("win:launchNew", app.windows[0])),
      });
      if (folders.length) items.push(...folders, { separator: true });
      if (app.pinned && app.pin) {
        items.push({ label: "Unpin from dock", icon: <PinOff size={14} />, disabled: s.lock, onClick: () => setSettings({ pins: s.pins.filter((p) => p.id !== app.pin!.id) }) });
        const i = s.pins.findIndex((p) => p.id === app.pin!.id);
        const next = s.pins[i + 1];
        if (next) {
          items.push({
            label: next.group ? `Add to ${next.group.name}` : `Group with ${next.name}`,
            icon: <FolderPlus size={14} />,
            disabled: s.lock,
            onClick: () => {
              const mine = app.pin!;
              const items = next.group ? [mine, ...next.group.items] : [mine, next];
              const name = next.group?.name ?? "Apps";
              const pins = s.pins.filter((p) => p.id !== mine.id).map((p) => (p.id === next.id ? { id: next.id, name, group: { name, items } } : p));
              setSettings({ pins });
            },
          });
        }
      } else if (app.windows[0]) {
        items.push({ label: "Pin to dock", icon: <PinIcon size={14} />, onClick: () => void vyse.invoke("pins:fromWindow", app.windows[0], app.name) });
      }
      if (app.windows.length) {
        items.push({ separator: true });
        items.push({ label: app.windows.length > 1 ? `Close ${app.windows.length} windows` : "Close window", icon: <X size={14} />, onClick: () => app.windows.forEach((w) => void host("close", { hwnd: w.hwnd })) });
        items.push({ label: "End task", icon: <Skull size={14} />, danger: true, onClick: () => [...new Set(app.windows.map((w) => w.pid))].forEach((pid) => void vyse.invoke("win:kill", pid)) });
      }
    }
    dock.openMenu(at, items);
  };

  // Win+n (see Apps below) lands here: the same as the Windows taskbar does with its button n
  const keyAction = (mode: string) => {
    const el = ref.current;
    if (!el) return;
    if (mode === "menu") {
      const r = el.getBoundingClientRect();
      return void openMenuAt({ x: Math.round(r.left + r.width / 2), y: Math.round(dock.edge === "bottom" ? r.top - 4 : r.bottom + 4) });
    }
    if (isGroup) {
      if (dock.cardUid === app.key) return dock.closeCard();
      return dock.openCard(app.key, el, <GroupCard app={app} close={dock.closeCard} />, { width: 330 });
    }
    const wins = app.windows;
    if (mode === "new" || !wins.length) {
      void bounce.start({ y: [0, -12, 0, -5, 0], transition: { duration: 0.7, ease: "easeOut" } });
      if (app.pin) void launch(app.pin);
      else if (wins[0]) void vyse.invoke("win:launchNew", wins[0]);
      return;
    }
    dock.closeCard();
    // windows come newest-first: Ctrl goes to the one you used last
    if (mode === "last") return void activate(wins[0], false);
    // one window: up, or down again if it's already in front
    if (wins.length === 1) return void activate(wins[0]);
    // several: each press moves on to the next, in a fixed order; from another app, the last used
    const ring = [...wins].sort((a, b) => a.hwnd - b.hwnd);
    const i = ring.findIndex((w) => w.active);
    void activate(i < 0 ? wins[0] : ring[(i + 1) % ring.length], false);
  };
  const keyRef = useRef(keyAction);
  keyRef.current = keyAction;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: Event) => keyRef.current((e as CustomEvent<string>).detail);
    el.addEventListener("vyse-hotkey", on);
    return () => el.removeEventListener("vyse-hotkey", on);
  }, []);

  const enter = () => {
    setHover(true);
    if (!s.previews || !app.windows.length || isGroup || dragging) return;
    if (dock.cardUid === app.key) return dock.hoverCard(true);
    hoverTimer.current = setTimeout(() => openPreviews(true), dock.cardUid ? 60 : 450);
  };
  const leave = () => {
    setHover(false);
    clearTimeout(hoverTimer.current);
    if (dock.cardUid === app.key) dock.hoverCard(false);
  };

  const showLabel = s.labels && hover && !dragging && dock.cardUid !== app.key;
  return (
    <motion.div
      ref={ref}
      data-hit
      data-app={app.key}
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: hover && !dragging ? "var(--tile-hover)" : app.active ? "var(--app-active)" : "transparent", transition: "background 0.15s" }}
      onClick={click}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        if (app.pin) void launch(app.pin);
        else if (app.windows[0]) void vyse.invoke("win:launchNew", app.windows[0]);
      }}
      onContextMenu={menu}
      onMouseEnter={enter}
      onMouseLeave={leave}
      // a file dragged over an open app brings its window up, so you can drop it there
      onDragEnter={() => {
        if (!app.windows[0]) return;
        clearTimeout(dragTimer.current);
        dragTimer.current = setTimeout(() => void activate(app.windows[0], false), 550);
      }}
      onDragLeave={() => clearTimeout(dragTimer.current)}
      onDrop={() => clearTimeout(dragTimer.current)}
      animate={bounce}
    >
      <motion.div animate={{ scale: hover && !dragging ? 1.06 : 1, y: hover && !dragging ? (dock.edge === "bottom" ? -1 : 1) : 0 }} transition={{ type: "spring", stiffness: 500, damping: 26 }}>
        {isGroup ? <GroupIcon app={app} size={iconSize} /> : app.icon ? <img src={app.icon} draggable={false} style={{ width: iconSize, height: iconSize }} className="drop-shadow-[0_1px_2px_rgb(0_0_0/0.22)]" /> : <span className="block rounded-[25%]" style={{ width: iconSize, height: iconSize, background: "var(--tile)" }} />}
      </motion.div>
      <Indicator app={app} edge={dock.edge} />
      <AnimatePresence>
        {showLabel && (
          <motion.span
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-[8px] px-2 py-[3px] text-[11.5px] font-medium"
            style={{ [dock.edge === "bottom" ? "bottom" : "top"]: size + 10, background: "var(--card-solid)", color: "var(--fg)", border: "1px solid var(--card-border)", boxShadow: "0 4px 14px rgb(0 0 0 / 0.25)" }}
            initial={{ opacity: 0, y: dock.edge === "bottom" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.12, delay: 0.25 }}
          >
            {app.name}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------- the section ----------

const pinKey = (p: Pin) => (p.group ? "group:" : "pin:") + p.id;

export function Apps({ onDragStart }: { onDragStart?: (e: React.PointerEvent) => void }) {
  const s = useSettings();
  const dock = useDock();
  const apps = useTopic<AppItem[]>("apps") ?? [];
  const [order, setOrder] = useState<string[]>(s.pins.map((p) => p.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const pinsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dragId) setOrder(s.pins.map((p) => p.id));
  }, [s.pins, dragId]);

  // Win+1...9, Win+0: the nth app on the dock, counting pinned then running, left to right
  useEffect(
    () =>
      vyse.on("dock:hotkey", (k: { index: number; mode: string }) => {
        const icons = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-app]") ?? [])];
        icons[k.index]?.dispatchEvent(new CustomEvent("vyse-hotkey", { detail: k.mode }));
      }),
    [],
  );

  const byKey = new Map(apps.map((a) => [a.key, a]));
  const pinned = order.map((id) => s.pins.find((p) => p.id === id)).filter((p): p is Pin => !!p);
  const running = apps.filter((a) => !a.pinned);

  // files dropped on the apps become pins where they land
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const paths = [...e.dataTransfer.files].map((f) => vyse.pathOf(f)).filter(Boolean);
    if (!paths.length || s.lock) return;
    const icons = [...(pinsRef.current?.querySelectorAll<HTMLElement>("[data-app]") ?? [])];
    const index = icons.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    void vyse.invoke("pins:fromPaths", paths, index);
  };

  return (
    <div ref={rootRef} className="flex h-full items-center" style={{ gap: s.spacing }} onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      <StartButton onDragStart={onDragStart} />
      <Reorder.Group as="div" ref={pinsRef} axis="x" values={order} onReorder={setOrder} className="flex h-full items-center" style={{ gap: s.spacing }}>
        {pinned.map((p) => {
          const app = byKey.get(pinKey(p)) ?? { key: pinKey(p), name: p.name, pinned: true, pin: p, windows: [], active: false, flashing: false };
          return (
            <Reorder.Item
              as="div"
              key={p.id}
              value={p.id}
              drag={!s.lock}
              dragSnapToOrigin
              className="relative"
              style={{ zIndex: dragId === p.id ? 10 : 0 }}
              animate={{ opacity: dragId === p.id && away ? 0.45 : 1, scale: dragId === p.id && away ? 0.8 : 1 }}
              onDragStart={() => {
                setDragId(p.id);
                dock.markDragged();
              }}
              onDrag={(_, info) => setAway(Math.abs(info.offset.y) > 56)}
              onDragEnd={(_, info) => {
                dock.markDragged();
                const removed = Math.abs(info.offset.y) > 56;
                setDragId(null);
                setAway(false);
                if (removed) setSettings({ pins: s.pins.filter((x) => x.id !== p.id) });
                else setSettings({ pins: order.map((id) => s.pins.find((x) => x.id === id)).filter((x): x is Pin => !!x) });
              }}
            >
              <AppIcon app={app} dragging={dragId === p.id} />
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      {running.length > 0 && pinned.length > 0 && <span className="mx-0.5 w-px self-center rounded-full" style={{ height: dock.tile * 0.55, background: "var(--line)" }} />}
      <AnimatePresence initial={false}>
        {running.map((a) => (
          <motion.div key={a.key} layout initial={{ opacity: 0, scale: 0.6, width: 0 }} animate={{ opacity: 1, scale: 1, width: dock.tile }} exit={{ opacity: 0, scale: 0.6, width: 0 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}>
            <AppIcon app={a} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** what the picker shows for the apps section */
function AppsPreview(_: TileProps) {
  const { tile } = useDock();
  const colors = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2"];
  return (
    <div className="flex h-full items-center gap-1.5 px-1">
      <span className="grid place-items-center rounded-[30%]" style={{ width: tile, height: tile, background: "var(--tile)" }}><WindowsLogo size={tile * 0.5} /></span>
      {colors.map((c) => <span key={c} className="rounded-[25%]" style={{ width: tile * 0.62, height: tile * 0.62, margin: tile * 0.19, background: c }} />)}
    </div>
  );
}

export const appsWidget: WidgetDef = {
  type: "apps",
  name: "Apps",
  category: "Apps & Files",
  description: "Start, your pinned apps and everything that's running - the taskbar, rebuilt.",
  Tile: AppsPreview,
  plain: true,
  single: true,
};
