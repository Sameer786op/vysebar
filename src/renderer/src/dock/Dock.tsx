// The dock: a plate along the screen edge with the apps and the widgets you picked. Cards,
// menus and toasts open out of it inside the same transparent window; everywhere else the
// mouse goes straight through to the apps behind.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { ArrowDownToLine, ArrowUpToLine, EyeOff, LayoutGrid, Lock, Minus, Monitor, Power, Settings2, SquareTerminal } from "lucide-react";
import type { DockInfo, Settings, WidgetInstance } from "@shared/types";
import { host, setSettings, useBattery, useLite, useSettings, useStore } from "../lib/state";
import { DockContext, useDock, type DockApi, type MenuItem, type WidgetDef } from "../widgets/types";
import { widgetByType } from "../widgets/registry";
import { Apps } from "./Apps";
import { Card, Menu, Toasts, type CardState } from "./Overlay";
import { Glass, type GlassMode } from "./Glass";

const vyse = window.vyse;

export interface Look {
  plate: string;
  border: string;
  /** small inner backgrounds (the Start square, folder icons) */
  tile: string;
  /** a widget's background at rest: none on a plate, so widgets sit on it without boxes */
  rest: string;
  tileHover: string;
  light: boolean;
  glass: GlassMode;
  shadow: string;
}

/** the six styles */
export function lookOf(s: Settings): Look {
  const shadow = "0 10px 30px rgb(0 0 0 / 0.28), 0 1px 3px rgb(0 0 0 / 0.2)";
  switch (s.style) {
    case "black":
      return { plate: "rgb(14 14 16 / 0.95)", border: "rgb(255 255 255 / 0.09)", tile: "rgb(255 255 255 / 0.07)", rest: "transparent", tileHover: "rgb(255 255 255 / 0.08)", light: false, glass: "off", shadow };
    case "white":
      return { plate: "rgb(250 250 252 / 0.96)", border: "rgb(0 0 0 / 0.08)", tile: "rgb(0 0 0 / 0.045)", rest: "transparent", tileHover: "rgb(0 0 0 / 0.05)", light: true, glass: "off", shadow: "0 10px 30px rgb(0 0 0 / 0.16), 0 1px 3px rgb(0 0 0 / 0.1)" };
    case "glass":
      return { plate: "rgb(16 16 20 / 0.16)", border: "rgb(255 255 255 / 0.14)", tile: "rgb(20 20 24 / 0.22)", rest: "transparent", tileHover: "rgb(255 255 255 / 0.09)", light: false, glass: "liquid", shadow: "0 12px 34px rgb(0 0 0 / 0.25)" };
    case "ios":
      return { plate: "rgb(255 255 255 / 0.3)", border: "rgb(255 255 255 / 0.45)", tile: "rgb(255 255 255 / 0.45)", rest: "transparent", tileHover: "rgb(0 0 0 / 0.05)", light: true, glass: "frost", shadow: "0 12px 34px rgb(0 0 0 / 0.2)" };
    case "midnight":
      return { plate: "linear-gradient(120deg, rgb(13 17 43 / 0.97), rgb(33 22 70 / 0.97))", border: "rgb(150 160 255 / 0.2)", tile: "rgb(255 255 255 / 0.07)", rest: "transparent", tileHover: "rgb(255 255 255 / 0.08)", light: false, glass: "off", shadow: "0 10px 34px rgb(20 10 60 / 0.45)" };
    case "clear":
      if (s.clearTiles === "white") return { plate: "transparent", border: "transparent", tile: "rgb(250 250 252 / 0.93)", rest: "rgb(250 250 252 / 0.93)", tileHover: "rgb(255 255 255 / 0.98)", light: true, glass: "off", shadow: "none" };
      if (s.clearTiles === "frosted") return { plate: "transparent", border: "transparent", tile: "transparent", rest: "transparent", tileHover: "rgb(255 255 255 / 0.06)", light: false, glass: "tiles", shadow: "none" };
      return { plate: "transparent", border: "transparent", tile: "rgb(16 16 18 / 0.9)", rest: "rgb(16 16 18 / 0.9)", tileHover: "rgb(30 30 34 / 0.92)", light: false, glass: "off", shadow: "none" };
  }
}

// ---------- one widget ----------

function WidgetItem({ inst, def, look, remove, onDragEdge }: { inst: WidgetInstance; def: WidgetDef; look: Look; remove: () => void; onDragEdge: (dragging: boolean) => void }) {
  const s = useSettings();
  const dock = useDock();
  const pickerOpen = useStore((st) => st.pickerOpen);
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const [dragging, setDragging] = useState(false);
  const active = dock.cardUid === inst.uid;
  const radius = Math.round(dock.tile * 0.3);
  // tiles were drawn for a 44 px row; other dock sizes scale them, so every widget fits any size
  const zoom = Math.min(1.3, Math.max(0.72, dock.tile / 44));
  const isApps = def.type === "apps";
  const startDrag = (e: React.PointerEvent) => {
    if (s.lock || e.button !== 0) return;
    controls.start(e);
  };

  const click = () => {
    if (dock.justDragged()) return;
    if (def.action) return def.action(inst);
    if (def.Card && ref.current) dock.openCard(inst.uid, ref.current, <def.Card inst={inst} close={dock.closeCard} />, { width: def.cardWidth, focus: def.cardFocus });
  };

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const own = def.menu?.(inst) ?? [];
    const items: MenuItem[] = [
      ...own,
      ...(own.length ? [{ separator: true }] : []),
      { label: `Remove ${def.name}`, icon: <Minus size={14} />, disabled: s.lock, onClick: remove },
      { label: "Widgets...", icon: <LayoutGrid size={14} />, onClick: () => void vyse.invoke("window:widgets") },
      { label: "Dock Settings...", icon: <Settings2 size={14} />, onClick: () => void vyse.invoke("window:settings") },
    ];
    dock.openMenu({ x: e.clientX, y: e.clientY }, items);
  };

  return (
    <Reorder.Item
      as="div"
      value={inst.uid}
      dragListener={false}
      dragControls={controls}
      dragSnapToOrigin
      className="relative shrink-0"
      style={{ zIndex: dragging ? 30 : 1 }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: away ? 0.4 : 1, scale: away ? 0.82 : 1 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      onDragStart={() => {
        setDragging(true);
        onDragEdge(true);
        dock.markDragged();
      }}
      onDrag={(_, info) => setAway(Math.abs(info.offset.y) > 60)}
      onDragEnd={(_, info) => {
        dock.markDragged();
        setDragging(false);
        setAway(false);
        onDragEdge(false);
        if (Math.abs(info.offset.y) > 60) remove();
      }}
    >
      {isApps ? (
        <Apps onDragStart={startDrag} />
      ) : (
        <motion.div
          ref={ref}
          data-hit
          data-glass="tile"
          onPointerDown={startDrag}
          onClick={click}
          onContextMenu={menu}
          whileTap={{ scale: 0.97 }}
          className="relative cursor-default select-none overflow-hidden"
          style={{
            height: dock.tile,
            borderRadius: radius,
            background: active ? look.tileHover : look.rest,
            boxShadow: look.glass === "tiles" ? "inset 0 0 0 1px rgb(255 255 255 / 0.14)" : s.style === "clear" ? "0 6px 18px rgb(0 0 0 / 0.25)" : undefined,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => !active && (e.currentTarget.style.background = look.tileHover)}
          onMouseLeave={(e) => !active && (e.currentTarget.style.background = look.rest)}
        >
          <div style={{ zoom, height: dock.tile / zoom }}>
            <def.Tile inst={inst} />
          </div>
        </motion.div>
      )}
      <AnimatePresence>
        {pickerOpen && !s.lock && (
          <motion.button
            data-hit
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              remove();
            }}
            className="absolute -left-1.5 -top-1.5 z-40 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#8e8e93] text-white shadow"
          >
            <Minus size={12} strokeWidth={3} />
          </motion.button>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

// ---------- the dock ----------

export function Dock({ displayId }: { displayId: number }) {
  const s = useSettings();
  const lite = useLite();
  const look = lookOf(s);
  const [info, setInfo] = useState<DockInfo | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [plateRect, setPlateRect] = useState<DOMRect | null>(null);
  const [pull, setPull] = useState(0);
  const [glassFailed, setGlassFailed] = useState(false);
  useEffect(() => setGlassFailed(false), [look.glass, lite]);
  const [order, setOrder] = useState<string[]>(s.widgets.map((w) => w.uid));
  const [reordering, setReordering] = useState(false);
  const plate = useRef<HTMLDivElement>(null);
  const cardRef = useRef<CardState | null>(null);
  const focused = useRef(false);
  const dragging = useRef(false);
  const lastDrag = useRef(0);
  const hov = useRef({ tile: false, card: false });
  const hovTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  cardRef.current = card;

  const pad = Math.max(3, Math.round(s.size * 0.065));
  const tile = s.size - pad * 2;
  const radius = Math.round(s.size * 0.32);
  const edge = s.edge;

  // ---- window, theme ----
  useEffect(() => {
    void vyse.invoke<DockInfo | null>("dock:info").then(setInfo);
    return vyse.on("dock:info", (i: DockInfo) => setInfo(i));
  }, [displayId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.edge = edge;
    root.classList.toggle("theme-light", look.light);
    root.classList.toggle("theme-dark", !look.light);
    root.style.setProperty("--accent", s.accent);
  }, [edge, look.light, s.accent]);

  useEffect(() => {
    if (!reordering) setOrder(s.widgets.map((w) => w.uid));
  }, [s.widgets, reordering]);

  // ---- cards and menus ----
  const setFocus = (on: boolean) => {
    if (focused.current === on) return;
    focused.current = on;
    vyse.send("dock:focus", on);
  };

  const closeCard = useCallback(() => {
    clearTimeout(hovTimer.current);
    setCard(null);
    setFocus(false);
  }, []);

  const openCard: DockApi["openCard"] = useCallback((uid, anchor, content, opts) => {
    const prev = cardRef.current;
    setMenu(null);
    // clicking the tile of an open card closes it; a hover card becomes a clicked one
    if (prev && prev.uid === uid && !prev.hover && !opts?.hover) return closeCard();
    if (opts?.hover && prev && !prev.hover) return;
    clearTimeout(hovTimer.current);
    if (opts?.hover) hov.current = { tile: true, card: false };
    setCard({ uid, anchor: anchor.getBoundingClientRect(), content, width: opts?.width ?? 340, hover: opts?.hover, padding: opts?.padding });
    setFocus(!!opts?.focus);
  }, [closeCard]);

  const hoverChange = (k: "tile" | "card", inside: boolean) => {
    hov.current[k] = inside;
    clearTimeout(hovTimer.current);
    if (!hov.current.tile && !hov.current.card) {
      hovTimer.current = setTimeout(() => {
        if (cardRef.current?.hover) setCard(null);
      }, 220);
    }
  };

  const openMenu = useCallback((at: { x: number; y: number }, items: MenuItem[]) => {
    setCard((c) => (c?.hover ? null : c));
    setMenu({ at, items });
  }, []);

  const api: DockApi = {
    edge,
    preview: false,
    light: look.light,
    openCard,
    hoverCard: (inside) => hoverChange("tile", inside),
    closeCard,
    cardUid: card?.uid ?? null,
    openMenu,
    justDragged: () => Date.now() - lastDrag.current < 250,
    markDragged: () => (lastDrag.current = Date.now()),
    tile,
  };

  // a real app taking the foreground (you clicked somewhere else) closes what is open
  useEffect(
    () =>
      vyse.on("foreground", (f: { app: boolean }) => {
        if (!f.app) return;
        setMenu(null);
        if (cardRef.current) closeCard();
      }),
    [closeCard],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      closeCard();
    };
    const blur = () => {
      if (focused.current && cardRef.current && !cardRef.current.hover) closeCard();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [closeCard]);

  // ---- the mouse: only the dock and what is open out of it take it ----
  useEffect(() => {
    let last: boolean | null = null;
    const set = (on: boolean) => {
      if (on === last) return;
      last = on;
      vyse.send("dock:interactive", on);
    };
    const move = (e: MouseEvent) => {
      const hit = dragging.current || !!document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-hit]");
      set(hit);
      if (useStore.getState().settings.autoHide) {
        clearTimeout(hideTimer.current);
        if (!hit && !cardRef.current) hideTimer.current = setTimeout(() => !dragging.current && !cardRef.current && setHidden(true), 650);
      }
    };
    const leave = () => set(dragging.current);
    window.addEventListener("mousemove", move);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, []);

  // ---- auto-hide ----
  useEffect(() => {
    if (!s.autoHide) return setHidden(false);
    const t = setTimeout(() => !cardRef.current && setHidden(true), 1500);
    const off = vyse.on("dock:reveal", () => {
      clearTimeout(hideTimer.current);
      setHidden(false);
    });
    // Start closed again: hide unless a card is open
    const offConceal = vyse.on("dock:conceal", () => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => !dragging.current && !cardRef.current && setHidden(true), 400);
    });
    return () => {
      clearTimeout(t);
      off();
      offConceal();
    };
  }, [s.autoHide]);

  useEffect(() => {
    if (hidden) {
      setMenu(null);
      closeCard();
    }
  }, [hidden, closeCard]);

  // ---- more widgets than the screen is wide: the dock shrinks to fit rather than run off the edges ----
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = plate.current;
    if (!el || s.fullWidth) return setFit(1);
    const measure = () => {
      // offsetWidth is the size before scaling, so this never feeds back on itself
      const avail = window.innerWidth - s.distance * 2;
      const w = el.offsetWidth;
      setFit(w > avail && w > 0 ? Math.max(0.6, Math.floor((avail / w) * 1000) / 1000) : 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [s.distance, s.fullWidth]);

  // ---- where the plate is: for cards, toasts and Explorer drags ----
  useLayoutEffect(() => {
    const el = plate.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      setPlateRect(r);
      vyse.send("dock:plate", { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    report();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [edge, s.size, s.distance, s.fullWidth, hidden, fit]);

  // ---- battery alerts ----
  const battery = useBattery();
  const warned = useRef(0);
  useEffect(() => {
    if (!info?.primary || !battery || !s.automations.batteryLow) return;
    if (battery.charging || battery.level > 0.2) {
      warned.current = 0;
      return;
    }
    const level = battery.level <= 0.06 ? 2 : battery.level <= 0.15 ? 1 : 0;
    if (level > warned.current) {
      warned.current = level;
      void vyse.invoke("toast", { title: level === 2 ? "Battery critically low" : "Battery low", body: `${Math.round(battery.level * 100)}% left - plug in soon`, icon: "bell", accent: "#ff453a" });
    }
  }, [battery?.level, battery?.charging, info?.primary, s.automations.batteryLow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- widgets ----
  const widgets = order
    .map((uid) => s.widgets.find((w) => w.uid === uid))
    .filter((w): w is WidgetInstance => !!w && widgetByType.has(w.type));
  const remove = (uid: string) => {
    if (cardRef.current?.uid === uid) closeCard();
    setSettings({ widgets: useStore.getState().settings.widgets.filter((w) => w.uid !== uid) });
  };
  const commitOrder = () => {
    const all = useStore.getState().settings.widgets;
    setSettings({ widgets: order.map((uid) => all.find((w) => w.uid === uid)).filter((w): w is WidgetInstance => !!w) });
  };

  // ---- dragging the dock itself to the other edge ----
  const edgeDrag = useRef<{ y0: number } | null>(null);
  const platePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || s.lock) return;
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.spacer) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    edgeDrag.current = { y0: e.screenY };
    dragging.current = true;
  };
  const platePointerMove = (e: React.PointerEvent) => {
    if (!edgeDrag.current) return;
    const dy = e.screenY - edgeDrag.current.y0;
    setPull(dy);
  };
  const platePointerUp = (e: React.PointerEvent) => {
    if (!edgeDrag.current) return;
    const dy = e.screenY - edgeDrag.current.y0;
    edgeDrag.current = null;
    dragging.current = false;
    setPull(0);
    const far = (info?.bounds.height ?? 1000) * 0.35;
    if (edge === "bottom" && dy < -far) setSettings({ edge: "top" });
    else if (edge === "top" && dy > far) setSettings({ edge: "bottom" });
    else if (Math.abs(dy) > 6) lastDrag.current = Date.now();
  };

  const plateMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, [
      { label: "Widgets...", icon: <LayoutGrid size={14} />, onClick: () => void vyse.invoke("window:widgets") },
      { label: "Dock Settings...", icon: <Settings2 size={14} />, onClick: () => void vyse.invoke("window:settings") },
      { separator: true },
      edge === "bottom"
        ? { label: "Move to top", icon: <ArrowUpToLine size={14} />, onClick: () => setSettings({ edge: "top" }) }
        : { label: "Move to bottom", icon: <ArrowDownToLine size={14} />, onClick: () => setSettings({ edge: "bottom" }) },
      { label: "Auto-hide", icon: <EyeOff size={14} />, checked: s.autoHide, onClick: () => setSettings({ autoHide: !s.autoHide }) },
      { label: "Lock the dock", icon: <Lock size={14} />, checked: s.lock, onClick: () => setSettings({ lock: !s.lock }) },
      { separator: true },
      { label: "Task Manager", icon: <SquareTerminal size={14} />, onClick: () => void vyse.invoke("run", "taskmgr") },
      { label: "Show desktop", icon: <Monitor size={14} />, onClick: () => void host("showDesktop") },
      { separator: true },
      { label: "Quit VyseBar", icon: <Power size={14} />, danger: true, onClick: () => void vyse.invoke("app:quit") },
    ]);
  };

  // rubber-band pull while dragging toward the other edge
  const pullY = Math.sign(pull) * Math.min(Math.abs(pull), 260) * 0.45;
  const offscreen = (s.size + s.distance + 16) * (edge === "bottom" ? 1 : -1);
  const plateStyle: CSSProperties = {
    padding: pad,
    gap: s.spacing,
    height: s.size,
    borderRadius: radius,
    // glass that couldn't start gets a solid plate, so the dock stays readable
    background: glassFailed && look.glass !== "off" && look.glass !== "tiles" ? (look.light ? "rgb(246 246 248 / 0.95)" : "rgb(24 24 28 / 0.93)") : look.plate,
    boxShadow: look.shadow === "none" ? undefined : `${look.shadow}, inset 0 0 0 1px ${look.border}`,
    color: "var(--fg)",
    textShadow: look.glass === "liquid" ? "0 1px 2px rgb(0 0 0 / 0.35)" : undefined,
    width: s.fullWidth ? "100%" : "max-content",
    transformOrigin: edge === "bottom" ? "50% 100%" : "50% 0%",
  } as CSSProperties;
  const backdrop = (card && !card.hover) || menu;

  return (
    <DockContext.Provider value={api}>
      <div className="fixed inset-0 overflow-hidden" style={{ "--tile": look.tile, "--tile-hover": look.tileHover } as CSSProperties}>
        <Glass mode={look.glass} info={info} light={look.light} live={!lite} onFail={() => setGlassFailed(true)} />
        {backdrop && (
          <div
            data-hit
            className="absolute inset-0"
            onPointerDown={() => {
              setMenu(null);
              closeCard();
            }}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ [edge === "bottom" ? "bottom" : "top"]: s.distance, paddingInline: s.distance }}>
        <motion.div
          ref={plate}
          data-hit
          data-glass="dock"
          className="pointer-events-auto flex shrink-0 items-center"
          style={plateStyle}
          initial={{ opacity: 0, y: offscreen * 0.6, scale: 0.96 }}
          animate={{ opacity: 1, y: hidden ? offscreen : pullY, scale: fit }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          onPointerDown={platePointerDown}
          onPointerMove={platePointerMove}
          onPointerUp={platePointerUp}
          onContextMenu={plateMenu}
        >
          <Reorder.Group
            as="div"
            axis="x"
            values={order}
            onReorder={setOrder}
            className={`flex h-full items-center ${s.fullWidth ? "w-full" : "flex-none"}`}
            style={{ gap: s.spacing }}
          >
            <AnimatePresence initial={false}>
              {widgets.flatMap((inst, i) => {
                const def = widgetByType.get(inst.type)!;
                const item = (
                  <WidgetItem
                    key={inst.uid}
                    inst={inst}
                    def={def}
                    look={look}
                    remove={() => remove(inst.uid)}
                    onDragEdge={(on) => {
                      dragging.current = on;
                      setReordering(on);
                      if (!on) commitOrder();
                    }}
                  />
                );
                // full width: the apps stay on the left and the widgets go to the right
                return s.fullWidth && def.type === "apps" && i < widgets.length - 1 ? [item, <div key="spacer" data-spacer="1" className="h-full flex-1" />] : [item];
              })}
            </AnimatePresence>
          </Reorder.Group>
          {!widgets.length && (
            <button className="px-4 text-[12.5px] font-medium" style={{ color: "var(--fg2)" }} onClick={() => void vyse.invoke("window:widgets")}>
              Add widgets
            </button>
          )}
        </motion.div>
        </div>

        <AnimatePresence>
          {card && (
            <Card key={card.uid} card={card} edge={edge} dockRect={plateRect} glass={look.glass !== "off"} onHover={(inside) => card.hover && hoverChange("card", inside)} />
          )}
        </AnimatePresence>
        <AnimatePresence>{menu && <Menu key={`${menu.at.x},${menu.at.y}`} at={menu.at} items={menu.items} edge={edge} onClose={() => setMenu(null)} />}</AnimatePresence>
        <Toasts edge={edge} dockRect={plateRect} />
      </div>
    </DockContext.Provider>
  );
}

